import { describe, expect, test } from "vitest";
import { CliUsageError, parseCliOptions } from "../../src/cli.js";

describe("private CLI boundary", () => {
    test.each([
        [[], "global"],
        [["--site", "global"], "global"],
        [["--site=cn"], "cn"]
    ])("accepts only a bounded site selection", (argv, site) => {
        expect(parseCliOptions(argv, {})).toEqual({ site, help: false });
    });

    test.each([
        [["--site", "leetcode"], {}],
        [["--site"], {}],
        [["--site", "global", "extra"], {}],
        [["--unknown"], {}],
        [["-s", "cn"], {}]
    ])("rejects unsupported CLI input %#", (argv, env) => {
        expect(() => parseCliOptions(argv, env)).toThrow(CliUsageError);
    });

    test("rejects session arguments without echoing their values", () => {
        const secret = "LEETCODE_SESSION_SHOULD_NEVER_BE_PRINTED";
        let message = "";
        try {
            parseCliOptions(["--session", secret], {});
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain("Session credentials are forbidden");
        expect(message).not.toContain(secret);
    });

    test.each(["", "LEETCODE_SESSION_SHOULD_NEVER_BE_PRINTED"])(
        "rejects an existing LEETCODE_SESSION without echoing it",
        (secret) => {
            let message = "";
            try {
                parseCliOptions([], { LEETCODE_SESSION: secret });
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain("LEETCODE_SESSION is forbidden");
            expect(secret === "" || !message.includes(secret)).toBe(true);
        }
    );
});
