import { describe, expect, test } from "vitest";
import {
    LeetCodeAdapterError,
    LeetCodeOjProvider
} from "../../src/oj/provider.js";
import {
    FIXED_NOW,
    createFakeService,
    premiumProblemFixture,
    problemRef,
    publicProblemFixture
} from "./fixtures.js";

describe("LeetCode OJ provider", () => {
    test("reports anonymous local stdio capabilities and disables every private or executable operation", async () => {
        const provider = createProvider();
        const result = await provider.getCapabilities();

        expect(result).toMatchObject({
            schemaVersion: "oj.capabilities/v1",
            providerVersion: "0.1.0",
            platform: "leetcode"
        });
        expect(Object.keys(result.operations).sort()).toEqual(
            [
                "commitSubmission",
                "fetchProblem",
                "fetchProfile",
                "importProblem",
                "listSubmissions",
                "localRun",
                "platformRun",
                "pollSubmission",
                "prepareSubmission",
                "searchProblems"
            ].sort()
        );
        expect(result.operations.searchProblems).toMatchObject({
            status: "available",
            toolName: "oj_search_problems",
            transport: "local_stdio",
            auth: "none",
            compliance: "unofficial"
        });
        expect(result.operations.fetchProblem).toMatchObject({
            status: "available",
            toolName: "oj_fetch_problem",
            transport: "local_stdio",
            auth: "none",
            compliance: "unofficial"
        });
        expect(
            Object.entries(result.operations)
                .filter(
                    ([name]) =>
                        name !== "searchProblems" && name !== "fetchProblem"
                )
                .every(([, operation]) => operation.status !== "available")
        ).toBe(true);
    });

    test("normalizes search through an explicit whitelist and drops premium results", async () => {
        const provider = createProvider();
        const result = await provider.search({
            schemaVersion: "oj.search-request/v1",
            requestId: "search-1",
            platform: "leetcode",
            query: "two sum",
            limit: 10
        });
        const serialized = JSON.stringify(result);

        expect(result).toMatchObject({
            schemaVersion: "oj.search-result/v1",
            requestId: "search-1",
            items: [
                {
                    schemaVersion: "oj.problem-summary/v1",
                    title: "Two Sum",
                    ref: {
                        platform: "leetcode",
                        site: "global",
                        nativeId: "two-sum",
                        canonicalId: "leetcode:global:two-sum"
                    },
                    acceptance: { ratio: 0.5525 }
                }
            ]
        });
        expect(serialized).not.toMatch(
            /hint|similarQuestions|editorial|solution|Premium|SECRET_/i
        );
    });

    test("derives a bounded next cursor from Global total when hasMore is absent", async () => {
        const service = createFakeService({
            searchProblems: async () => ({
                total: 2,
                questions: [
                    {
                        title: "Two Sum",
                        titleSlug: "two-sum",
                        topicTags: [],
                        isPaidOnly: false
                    }
                ]
            })
        });
        const provider = new LeetCodeOjProvider({
            service,
            site: "global",
            nowIso: () => FIXED_NOW
        });

        const result = await provider.search({
            schemaVersion: "oj.search-request/v1",
            requestId: "search-global-page-1",
            platform: "leetcode",
            query: "two",
            limit: 1
        });

        expect(result.nextCursor).toBe("v1:1");
    });

    test("normalizes a public problem without leaking answer-shaped or unknown fields", async () => {
        const provider = createProvider();
        const result = await provider.fetchProblem(problemRef());
        const serialized = JSON.stringify(result);

        expect(result).toMatchObject({
            schemaVersion: "oj.problem-document/v1",
            title: "Two Sum",
            locale: "en-US",
            access: "public",
            ref: { nativeId: "two-sum", site: "global" },
            content: {
                statement: {
                    text: publicProblemFixture.content,
                    format: "html",
                    truncated: false
                }
            },
            io: { mode: "function" }
        });
        expect(result.content.statement.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(serialized).not.toMatch(
            /SECRET_|"(?:hints|similarQuestions|editorial|solution|unexpected)"/i
        );
    });

    test("returns a policy error before exposing premium problem content", async () => {
        const provider = createProvider({
            fetchProblem: async () => premiumProblemFixture
        });

        await expect(
            provider.fetchProblem(problemRef("premium-secret"))
        ).rejects.toMatchObject({
            code: "policy.blocked"
        });
        await provider
            .fetchProblem(problemRef("premium-secret"))
            .catch((error) => {
                expect((error as Error).message).not.toContain(
                    "SECRET_PREMIUM_STATEMENT"
                );
            });
    });

    test("fails closed when search or fetch omits the Premium access marker", async () => {
        const searchProvider = createProvider({
            searchProblems: async () => ({
                total: 1,
                questions: [
                    {
                        title: "Unknown Access",
                        titleSlug: "unknown-access",
                        topicTags: [],
                        secret: "SECRET_PREMIUM_SEARCH"
                    }
                ]
            })
        });
        const fetchProvider = createProvider({
            fetchProblem: async () => {
                const { isPaidOnly: _marker, ...withoutMarker } =
                    premiumProblemFixture;
                return withoutMarker;
            }
        });

        await expect(
            searchProvider.search({
                schemaVersion: "oj.search-request/v1",
                requestId: "missing-access-search",
                platform: "leetcode",
                query: "unknown",
                limit: 10
            })
        ).rejects.toMatchObject({ code: "upstream.schema_changed" });
        await fetchProvider
            .fetchProblem(problemRef("premium-secret"))
            .then(() => {
                throw new Error(
                    "Missing Premium marker unexpectedly succeeded."
                );
            })
            .catch((error) => {
                expect(error).toMatchObject({
                    code: "upstream.schema_changed"
                });
                expect(JSON.stringify(error)).not.toContain(
                    "SECRET_PREMIUM_STATEMENT"
                );
            });
    });

    test("rejects mismatched canonical problem references before reading upstream", async () => {
        let fetches = 0;
        const provider = createProvider({
            fetchProblem: async () => {
                fetches += 1;
                return publicProblemFixture;
            }
        });

        await expect(
            provider.fetchProblem({
                ...problemRef(),
                canonicalId: "leetcode:global:another-problem"
            })
        ).rejects.toMatchObject({ code: "request.invalid" });
        expect(fetches).toBe(0);
    });

    test("bounds content and rejects upstream shape drift", async () => {
        const provider = createProvider({
            fetchProblem: async () => ({
                ...publicProblemFixture,
                content: "x".repeat(25_000)
            })
        });
        const truncated = await provider.fetchProblem(problemRef());
        expect(truncated.content.statement).toMatchObject({
            truncated: true,
            originalChars: 25_000
        });
        expect(truncated.content.statement.text).toHaveLength(20_000);

        const drifted = createProvider({
            fetchProblem: async () => ({ titleSlug: "two-sum" })
        });
        await expect(drifted.fetchProblem(problemRef())).rejects.toBeInstanceOf(
            LeetCodeAdapterError
        );
        await expect(drifted.fetchProblem(problemRef())).rejects.toMatchObject({
            code: "upstream.schema_changed"
        });
    });
});

function createProvider(overrides = {}) {
    return new LeetCodeOjProvider({
        service: createFakeService(overrides),
        site: "global",
        nowIso: () => FIXED_NOW
    });
}
