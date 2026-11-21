import { describe, expect, test } from "vitest";
import {
    LeetCodeAdapterError,
    LeetCodeOjProvider
} from "../../src/oj/provider.js";
import { createGraphqlQueryTransport } from "../../src/oj/transport.js";
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

    test("uses isPaidOnly for CN fetches and still fails closed when it is absent", async () => {
        const publicProvider = createProviderForSite("cn", {
            fetchProblem: async () => ({
                ...publicProblemFixture,
                isPaidOnly: false
            })
        });
        const premiumProvider = createProviderForSite("cn", {
            fetchProblem: async () => ({
                ...premiumProblemFixture,
                isPaidOnly: true
            })
        });
        const missingProvider = createProviderForSite("cn", {
            fetchProblem: async () => {
                const { isPaidOnly: _marker, ...withoutMarker } =
                    premiumProblemFixture;
                return withoutMarker;
            }
        });

        await expect(
            publicProvider.fetchProblem(problemRef("two-sum", "cn"))
        ).resolves.toMatchObject({
            access: "public",
            locale: "zh-CN",
            ref: { site: "cn" }
        });
        await expect(
            premiumProvider.fetchProblem(problemRef("premium-secret", "cn"))
        ).rejects.toMatchObject({
            code: "policy.blocked"
        });
        await expect(
            missingProvider.fetchProblem(problemRef("premium-secret", "cn"))
        ).rejects.toMatchObject({
            code: "upstream.schema_changed"
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

    test("supports direct GraphQL transport injection for CN and rejects site mismatch", async () => {
        const cnTransport = createGraphqlQueryTransport({
            site: "cn",
            client: {
                graphql: async () => ({
                    data: {
                        problemsetQuestionList: {
                            hasMore: true,
                            total: 3,
                            questions: [
                                {
                                    title: "Two Sum",
                                    titleCn: "两数之和",
                                    titleSlug: "two-sum",
                                    difficulty: "Easy",
                                    paidOnly: false,
                                    acRate: 0.5525,
                                    topicTags: [{ slug: "array" }]
                                },
                                {
                                    title: "Locked CN",
                                    titleCn: "会员专享",
                                    titleSlug: "locked-cn",
                                    difficulty: "Hard",
                                    paidOnly: true,
                                    acRate: 0.21,
                                    topicTags: [{ slug: "dp" }]
                                }
                            ]
                        }
                    }
                }),
                problem: async () => publicProblemFixture
            }
        });

        expect(
            () =>
                new LeetCodeOjProvider({
                    transport: cnTransport,
                    site: "global",
                    nowIso: () => FIXED_NOW
                })
        ).toThrow("Configured LeetCode site does not match transport site.");

        const provider = new LeetCodeOjProvider({
            transport: cnTransport,
            nowIso: () => FIXED_NOW
        });

        const searchResult = await provider.search({
            schemaVersion: "oj.search-request/v1",
            requestId: "cn-graphql-1",
            platform: "leetcode",
            query: "两数",
            locale: "zh-CN",
            limit: 2
        });
        expect(searchResult.items).toHaveLength(1);
        expect(searchResult.items[0]).toMatchObject({
            title: "两数之和",
            ref: {
                site: "cn",
                canonicalId: "leetcode:cn:two-sum",
                url: "https://leetcode.cn/problems/two-sum/"
            }
        });
        expect(searchResult.nextCursor).toBe("v1:2");

        const doc = await provider.fetchProblem(problemRef("two-sum", "cn"));
        expect(doc).toMatchObject({
            title: "两数之和",
            locale: "zh-CN",
            content: {
                statement: {
                    text: publicProblemFixture.translatedContent,
                    locale: "zh-CN"
                }
            }
        });
    });

    test("tracks health observations across upstream outcomes without poisoning health on caller input errors", async () => {
        let mode: "ok" | "timeout" | "down" = "ok";
        const provider = createProvider({
            searchProblems: async () => {
                if (mode === "timeout") {
                    throw new Error("ETIMEDOUT while reading upstream");
                }
                if (mode === "down") {
                    throw new Error("502 Bad Gateway SECRET_UPSTREAM_TRACE");
                }
                return {
                    total: 1,
                    questions: [
                        {
                            title: "Two Sum",
                            titleSlug: "two-sum",
                            topicTags: ["array"],
                            isPaidOnly: false
                        }
                    ]
                };
            }
        });

        await expect(provider.getHealth()).resolves.toMatchObject({
            overall: "degraded",
            layers: { schema: "unknown", upstream: "pass" }
        });

        await provider.search({
            schemaVersion: "oj.search-request/v1",
            requestId: "health-1",
            platform: "leetcode",
            query: "two",
            limit: 5
        });
        await expect(provider.getHealth()).resolves.toMatchObject({
            overall: "healthy",
            layers: { schema: "pass", upstream: "pass" }
        });

        // Caller validation error must not degrade upstream observation
        await expect(
            provider.search({
                schemaVersion: "oj.search-request/v1",
                requestId: "bad-cursor",
                platform: "leetcode",
                query: "two",
                cursor: "v1:99999",
                limit: 5
            })
        ).rejects.toMatchObject({ code: "request.invalid" });
        await expect(provider.getHealth()).resolves.toMatchObject({
            overall: "healthy"
        });

        mode = "timeout";
        await expect(
            provider.search({
                schemaVersion: "oj.search-request/v1",
                requestId: "health-timeout",
                platform: "leetcode",
                query: "two",
                limit: 5
            })
        ).rejects.toMatchObject({ code: "network.timeout" });
        await expect(provider.getHealth()).resolves.toMatchObject({
            overall: "degraded",
            layers: { upstream: "timeout" }
        });

        mode = "down";
        await expect(
            provider.search({
                schemaVersion: "oj.search-request/v1",
                requestId: "health-down",
                platform: "leetcode",
                query: "two",
                limit: 5
            })
        ).rejects.toMatchObject({ code: "upstream.unavailable" });
        await expect(provider.getHealth()).resolves.toMatchObject({
            overall: "unavailable",
            layers: { upstream: "fail" }
        });
    });
});

function createProvider(overrides = {}) {
    return createProviderForSite("global", overrides);
}

function createProviderForSite(site: "global" | "cn", overrides = {}) {
    return new LeetCodeOjProvider({
        service: createFakeService(overrides),
        site,
        nowIso: () => FIXED_NOW
    });
}
