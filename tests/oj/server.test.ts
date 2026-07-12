import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "vitest";
import { LeetCodeOjProvider } from "../../src/oj/provider.js";
import {
    createLeetCodeMcpServer,
    LEETCODE_MCP_TOOL_NAMES
} from "../../src/oj/server.js";
import {
    createFakeService,
    FIXED_NOW,
    premiumProblemFixture,
    problemRef
} from "./fixtures.js";

describe("private LeetCode MCP server", () => {
    test("lists exactly four strict anonymous read tools and no resources capability", async () => {
        const { client, close } = await connect();
        const listed = await client.listTools();

        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
            [...LEETCODE_MCP_TOOL_NAMES].sort()
        );
        expect(listed.tools).toHaveLength(4);
        expect(
            listed.tools.every(
                (tool) =>
                    tool.annotations?.readOnlyHint === true &&
                    tool.annotations?.destructiveHint === false &&
                    tool.annotations?.idempotentHint === true
            )
        ).toBe(true);
        expect(
            listed.tools.some((tool) =>
                /resource|user|profile|contest|solution|note|run|submit/i.test(
                    tool.name
                )
            )
        ).toBe(false);
        expect(client.getServerCapabilities()?.resources).toBeUndefined();

        const search = listed.tools.find(
            (tool) => tool.name === "oj_search_problems"
        )!;
        expect(search.inputSchema).toMatchObject({
            type: "object",
            additionalProperties: false,
            required: expect.arrayContaining([
                "schemaVersion",
                "requestId",
                "platform",
                "query",
                "limit"
            ]),
            properties: {
                schemaVersion: { const: "oj.search-request/v1" },
                platform: { const: "leetcode" },
                query: { minLength: 1, maxLength: 200 },
                limit: { type: "integer", minimum: 1, maximum: 50 }
            }
        });
        for (const tool of listed.tools) {
            expect(JSON.stringify(tool.outputSchema)).toContain("oj.error/v1");
        }
        await close();
    });

    test("returns success and policy failures in structuredContent", async () => {
        const { client, close } = await connect();
        const success = await client.callTool({
            name: "oj_search_problems",
            arguments: {
                schemaVersion: "oj.search-request/v1",
                requestId: "server-search-1",
                platform: "leetcode",
                query: "two sum",
                limit: 10
            }
        });
        expect(success.isError).not.toBe(true);
        expect(success.structuredContent).toMatchObject({
            schemaVersion: "oj.search-result/v1",
            requestId: "server-search-1"
        });

        const invalid = await client.callTool({
            name: "oj_search_problems",
            arguments: {
                schemaVersion: "oj.search-request/v1",
                requestId: "server-search-invalid",
                platform: "leetcode",
                query: "x",
                limit: 51,
                unexpected: true
            }
        });
        expect(invalid).toMatchObject({
            isError: true,
            structuredContent: {
                schemaVersion: "oj.error/v1",
                code: "request.invalid",
                layer: "broker"
            }
        });
        await close();
    });

    test("maps premium fetches to a non-leaking policy error", async () => {
        const provider = new LeetCodeOjProvider({
            service: createFakeService({
                fetchProblem: async () => premiumProblemFixture
            }),
            site: "global",
            nowIso: () => FIXED_NOW
        });
        const { client, close } = await connect(provider);
        const result = await client.callTool({
            name: "oj_fetch_problem",
            arguments: problemRef("premium-secret")
        });
        expect(result).toMatchObject({
            isError: true,
            structuredContent: {
                schemaVersion: "oj.error/v1",
                code: "policy.blocked",
                layer: "policy",
                retryPolicy: "never",
                userAction: "none"
            }
        });
        expect(JSON.stringify(result)).not.toContain(
            "SECRET_PREMIUM_STATEMENT"
        );
        await close();
    });
});

async function connect(provider = createProvider()) {
    const server = createLeetCodeMcpServer({ provider });
    const client = new Client({
        name: "private-leetcode-test",
        version: "0.1.0"
    });
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return {
        client,
        close: async () => {
            await client.close();
            await server.close();
        }
    };
}

function createProvider() {
    return new LeetCodeOjProvider({
        service: createFakeService(),
        site: "global",
        nowIso: () => FIXED_NOW
    });
}
