import { describe, expect, test, vi } from "vitest";
import {
    classifyTransportError,
    createAnonymousQueryTransport,
    createGraphqlQueryTransport,
    createServiceQueryTransport,
    getLeetCodeSiteDescriptor,
    LeetCodeGraphqlClient
} from "../../src/oj/transport.js";
import { createFakeService, publicProblemFixture } from "./fixtures.js";

describe("LeetCode site descriptors and query transports", () => {
    test("defines distinct Global and CN descriptors and paid marker fields", () => {
        const globalSite = getLeetCodeSiteDescriptor("global");
        const cnSite = getLeetCodeSiteDescriptor("cn");

        expect(globalSite).toMatchObject({
            site: "global",
            origin: "https://leetcode.com",
            problemsetUrl: "https://leetcode.com/problemset/",
            locale: "en-US",
            searchPaidMarkerField: "isPaidOnly",
            fetchPaidMarkerField: "isPaidOnly"
        });
        expect(globalSite.canonicalId("two-sum")).toBe(
            "leetcode:global:two-sum"
        );
        expect(globalSite.problemUrl("two-sum")).toBe(
            "https://leetcode.com/problems/two-sum/"
        );

        expect(cnSite).toMatchObject({
            site: "cn",
            origin: "https://leetcode.cn",
            problemsetUrl: "https://leetcode.cn/problemset/",
            locale: "zh-CN",
            searchPaidMarkerField: "paidOnly",
            fetchPaidMarkerField: "isPaidOnly"
        });
        expect(cnSite.canonicalId("two-sum")).toBe("leetcode:cn:two-sum");
        expect(cnSite.problemUrl("two-sum")).toBe(
            "https://leetcode.cn/problems/two-sum/"
        );
    });

    test("ServiceLeetCodeQueryTransport enforces anonymous boundary at construction and call time", async () => {
        expect(() =>
            createServiceQueryTransport({
                service: createFakeService({ isAuthenticated: () => true }),
                site: "global"
            })
        ).toThrow("Anonymous LeetCode service assertion failed.");

        let authenticated = false;
        const searchProblems = vi.fn(async () => ({
            total: 0,
            questions: []
        }));
        const transport = createServiceQueryTransport({
            service: createFakeService({
                isAuthenticated: () => authenticated,
                searchProblems
            }),
            site: "global"
        });

        await expect(
            transport.searchProblems({ query: "sum", limit: 5, offset: 10 })
        ).resolves.toEqual({ total: 0, questions: [] });
        expect(searchProblems).toHaveBeenCalledWith(
            "all-code-essentials",
            undefined,
            undefined,
            5,
            10,
            "sum"
        );

        authenticated = true;
        await expect(
            transport.searchProblems({ query: "sum", limit: 5, offset: 0 })
        ).rejects.toThrow("Anonymous LeetCode service assertion failed.");
        await expect(transport.fetchProblem("two-sum")).rejects.toThrow(
            "Anonymous LeetCode service assertion failed."
        );
    });

    test("ServiceLeetCodeQueryTransport maps missing problems to resource.not_found", async () => {
        const transport = createServiceQueryTransport({
            service: createFakeService({
                fetchProblem: async () => null
            }),
            site: "global"
        });

        await expect(
            transport.fetchProblem("missing-slug")
        ).rejects.toMatchObject({
            code: "resource.not_found"
        });
    });

    test("GraphqlLeetCodeQueryTransport dispatches Global and CN GraphQL dialects cleanly", async () => {
        const globalClient: LeetCodeGraphqlClient = {
            graphql: vi.fn(async () => ({
                data: {
                    problemsetQuestionList: {
                        total: 1,
                        questions: [
                            {
                                title: "Two Sum",
                                titleSlug: "two-sum",
                                difficulty: "EASY",
                                isPaidOnly: false,
                                acRate: 55.2,
                                topicTags: [{ slug: "array" }]
                            }
                        ]
                    }
                }
            })),
            problem: vi.fn(async () => publicProblemFixture)
        };

        const globalTransport = createGraphqlQueryTransport({
            site: "global",
            client: globalClient
        });
        const globalPage = await globalTransport.searchProblems({
            query: "two sum",
            limit: 10,
            offset: 20
        });
        expect(globalPage).toMatchObject({
            total: 1,
            questions: [{ titleSlug: "two-sum", isPaidOnly: false }]
        });
        expect(globalClient.graphql).toHaveBeenCalledWith(
            expect.objectContaining({
                query: expect.stringContaining("isPaidOnly"),
                variables: {
                    categorySlug: "all-code-essentials",
                    limit: 10,
                    skip: 20,
                    filters: { searchKeywords: "two sum" }
                }
            })
        );

        const cnClient: LeetCodeGraphqlClient = {
            graphql: vi.fn(async () => ({
                data: {
                    problemsetQuestionList: {
                        hasMore: false,
                        total: 1,
                        questions: [
                            {
                                title: "Two Sum",
                                titleCn: "两数之和",
                                titleSlug: "two-sum",
                                difficulty: "EASY",
                                paidOnly: false,
                                acRate: 0.552,
                                topicTags: [{ slug: "array" }]
                            }
                        ]
                    }
                }
            })),
            problem: vi.fn(async () => publicProblemFixture)
        };

        const cnTransport = createGraphqlQueryTransport({
            site: "cn",
            client: cnClient
        });
        const cnPage = await cnTransport.searchProblems({
            query: "两数之和",
            limit: 5,
            offset: 0
        });
        expect(cnPage).toMatchObject({
            hasMore: false,
            total: 1,
            questions: [
                { titleCn: "两数之和", titleSlug: "two-sum", paidOnly: false }
            ]
        });
        expect(cnClient.graphql).toHaveBeenCalledWith(
            expect.objectContaining({
                query: expect.stringContaining("paidOnly")
            })
        );
    });

    test("GraphqlLeetCodeQueryTransport rejects credentials, GraphQL errors, and missing root nodes", async () => {
        const stubClient: LeetCodeGraphqlClient = {
            graphql: async () => ({ data: {} }),
            problem: async () => null
        };

        expect(() =>
            createGraphqlQueryTransport({
                site: "global",
                client: stubClient,
                credential: { session: "SECRET_SESSION_COOKIE" }
            })
        ).toThrow("Anonymous LeetCode service assertion failed.");

        const missingRootTransport = createGraphqlQueryTransport({
            site: "global",
            client: stubClient
        });
        await expect(
            missingRootTransport.searchProblems({
                query: "two",
                limit: 1,
                offset: 0
            })
        ).rejects.toMatchObject({ code: "upstream.schema_changed" });
        await expect(
            missingRootTransport.fetchProblem("missing")
        ).rejects.toMatchObject({ code: "resource.not_found" });

        const rateLimitedTransport = createGraphqlQueryTransport({
            site: "cn",
            client: {
                graphql: async () => ({
                    errors: [
                        {
                            message:
                                "429 Too Many Requests SECRET_UPSTREAM_BODY"
                        }
                    ]
                }),
                problem: async () => null
            }
        });
        await rateLimitedTransport
            .searchProblems({ query: "two", limit: 1, offset: 0 })
            .then(() => {
                throw new Error("Expected rate limit error");
            })
            .catch((error) => {
                expect(error).toMatchObject({ code: "rate_limited" });
                expect((error as Error).message).not.toContain(
                    "SECRET_UPSTREAM_BODY"
                );
            });
    });

    test("createAnonymousQueryTransport creates unauthenticated Global and CN transports", () => {
        const globalTransport = createAnonymousQueryTransport("global");
        const cnTransport = createAnonymousQueryTransport("cn");

        expect(globalTransport.site).toBe("global");
        expect(globalTransport.isAuthenticated()).toBe(false);
        expect(cnTransport.site).toBe("cn");
        expect(cnTransport.isAuthenticated()).toBe(false);
    });

    test("classifyTransportError maps network, rate-limit, and unknown errors without leaking details", () => {
        const abortError = new Error("Request aborted with SECRET_TOKEN");
        abortError.name = "AbortError";
        expect(classifyTransportError(abortError)).toMatchObject({
            code: "network.timeout"
        });
        expect(classifyTransportError(abortError).message).not.toContain(
            "SECRET_TOKEN"
        );

        const nestedCodeError = new Error("fetch failed", {
            cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
        });
        expect(classifyTransportError(nestedCodeError)).toMatchObject({
            code: "network.timeout"
        });

        expect(
            classifyTransportError(new Error("HTTP 429 rate limit exceeded"))
        ).toMatchObject({
            code: "rate_limited"
        });

        expect(
            classifyTransportError(new Error("Problem does not exist"))
        ).toMatchObject({
            code: "resource.not_found"
        });

        const htmlFailure = new Error(
            "<html>SECRET_CLOUDFLARE_CHALLENGE</html>"
        );
        const mapped = classifyTransportError(htmlFailure);
        expect(mapped).toMatchObject({ code: "upstream.unavailable" });
        expect(mapped.message).not.toContain("SECRET_CLOUDFLARE_CHALLENGE");
    });
});
