import type { OjProblemRef } from "../../src/oj/contracts.js";
import type { AnonymousLeetCodeService } from "../../src/oj/service.js";

export const FIXED_NOW = "2026-07-12T08:00:00.000Z";

export function problemRef(
    nativeId = "two-sum",
    site: "global" | "cn" = "global"
): OjProblemRef {
    const origin =
        site === "cn" ? "https://leetcode.cn" : "https://leetcode.com";
    const source = {
        kind: "community_adapter" as const,
        adapterId: "leetcode-query-anonymous-adapter",
        adapterVersion: "0.1.0",
        fetchedAt: FIXED_NOW,
        sourceUrl: `${origin}/problemset/`,
        rawRef: nativeId,
        confidence: "derived" as const
    };
    return {
        schemaVersion: "oj.problem-ref/v1",
        platform: "leetcode",
        site,
        nativeId,
        canonicalId: `leetcode:${site}:${nativeId}`,
        url: `${origin}/problems/${nativeId}/`,
        source
    };
}

export const publicProblemFixture = {
    questionId: "1",
    questionFrontendId: "1",
    title: "Two Sum",
    translatedTitle: "两数之和",
    titleSlug: "two-sum",
    content: "<p>Return indices of the two numbers.</p>",
    translatedContent: "<p>返回两个数的下标。</p>",
    difficulty: "Easy",
    isPaidOnly: false,
    topicTags: [{ id: "VG9waWNUYWdOb2RlOjU=", name: "Array", slug: "array" }],
    codeSnippets: [
        {
            lang: "Python3",
            langSlug: "python3",
            code: "class Solution:\n    pass"
        }
    ],
    exampleTestcases: "[2,7,11,15]\n9",
    hints: ["SECRET_HINT"],
    similarQuestions: '[{"title":"SECRET_SIMILAR"}]',
    solution: { content: "SECRET_EDITORIAL" },
    editorial: { content: "SECRET_PREMIUM_EDITORIAL" },
    unexpected: "SECRET_EXTRA_FIELD"
};

export const premiumProblemFixture = {
    ...publicProblemFixture,
    title: "Premium Secret",
    titleSlug: "premium-secret",
    isPaidOnly: true,
    content: "SECRET_PREMIUM_STATEMENT"
};

export function createFakeService(
    overrides: Partial<AnonymousLeetCodeService> = {}
): AnonymousLeetCodeService {
    return {
        fetchProblem: async () => publicProblemFixture,
        searchProblems: async () => ({
            hasMore: true,
            total: 2,
            questions: [
                {
                    title: "Two Sum",
                    titleCn: "两数之和",
                    titleSlug: "two-sum",
                    difficulty: "Easy",
                    acRate: 55.25,
                    topicTags: ["array", "hash-table"],
                    isPaidOnly: false,
                    hints: ["SECRET_HINT"],
                    solution: "SECRET_SOLUTION"
                },
                {
                    title: "Premium Secret",
                    titleSlug: "premium-secret",
                    difficulty: "Hard",
                    acRate: 10,
                    topicTags: ["dynamic-programming"],
                    isPaidOnly: true,
                    editorial: "SECRET_EDITORIAL"
                }
            ]
        }),
        isAuthenticated: () => false,
        isCN: () => false,
        ...overrides
    };
}
