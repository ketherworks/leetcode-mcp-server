import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const execFileAsync = promisify(execFile);

describe("private package metadata and artifact", () => {
    test("records the private package identity and exact upstream baseline", async () => {
        const packageJson = JSON.parse(
            await readFile(
                new URL("../../package.json", import.meta.url),
                "utf8"
            )
        );
        const upstream = await readFile(
            new URL("../../UPSTREAM.md", import.meta.url),
            "utf8"
        );
        const notices = await readFile(
            new URL("../../THIRD_PARTY_NOTICES", import.meta.url),
            "utf8"
        );
        const license = await readFile(
            new URL("../../LICENSE", import.meta.url),
            "utf8"
        );

        expect(packageJson).toMatchObject({
            name: "@ketherworks/leetcode-mcp-private",
            version: "0.1.0",
            private: true,
            license: "MIT"
        });
        expect(packageJson.scripts).toMatchObject({
            build: "tsc",
            test: "vitest run",
            prepack: "npm run build"
        });
        expect(packageJson.files).toEqual(
            expect.arrayContaining([
                "build/index.js",
                "build/oj",
                "LICENSE",
                "README.md",
                "UPSTREAM.md",
                "THIRD_PARTY_NOTICES"
            ])
        );
        expect(upstream).toContain("v1.3.0");
        expect(upstream).toContain("caca0cb38a95dc2c5a8e411196f95c0a01f1f82c");
        expect(notices).toContain("jinzcdev/leetcode-mcp-server");
        expect(license).toContain("MIT License");
    });

    test("packs runtime, license, provenance, and boundary docs without source or tests", async () => {
        const npmCli = process.env.npm_execpath;
        expect(npmCli).toBeTruthy();
        const { stdout } = await execFileAsync(
            process.execPath,
            [npmCli!, "pack", "--dry-run", "--json"],
            { cwd: new URL("../..", import.meta.url), timeout: 60_000 }
        );
        const jsonStart = Math.max(0, stdout.lastIndexOf("\n[") + 1);
        const result = JSON.parse(stdout.slice(jsonStart)) as Array<{
            files: Array<{ path: string }>;
        }>;
        const files = result[0].files.map((entry) => entry.path);

        expect(files).toEqual(
            expect.arrayContaining([
                "build/index.js",
                "LICENSE",
                "README.md",
                "UPSTREAM.md",
                "THIRD_PARTY_NOTICES"
            ])
        );
        expect(files.some((path) => path.startsWith("src/"))).toBe(false);
        expect(files.some((path) => path.startsWith("tests/"))).toBe(false);
        expect(files.some((path) => path.startsWith("build/mcp/"))).toBe(false);
    }, 90_000);
});
