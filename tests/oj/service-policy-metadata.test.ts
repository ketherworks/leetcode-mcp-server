import { Credential, LeetCode, LeetCodeCN } from "leetcode-query";
import { describe, expect, test, vi } from "vitest";
import { LeetCodeCNService } from "../../src/leetcode/leetcode-cn-service.js";
import { LeetCodeGlobalService } from "../../src/leetcode/leetcode-global-service.js";

describe("premium policy metadata", () => {
    test("preserves Global isPaidOnly for adapter-side filtering", async () => {
        const graphql = vi.fn(async () => ({
            data: {
                problemsetQuestionList: {
                    total: 1,
                    questions: [question({ isPaidOnly: true })]
                }
            }
        }));
        const service = new LeetCodeGlobalService(
            { graphql } as unknown as LeetCode,
            new Credential()
        );

        const result = await service.searchProblems(
            undefined,
            undefined,
            undefined,
            10,
            0,
            "secret"
        );

        expect(result.questions[0]).toMatchObject({ isPaidOnly: true });
        expect(graphql.mock.calls[0][0].query).toContain("isPaidOnly");
    });

    test("preserves CN paidOnly for adapter-side filtering", async () => {
        const graphql = vi.fn(async () => ({
            data: {
                problemsetQuestionList: {
                    hasMore: false,
                    total: 1,
                    questions: [question({ paidOnly: true })]
                }
            }
        }));
        const service = new LeetCodeCNService(
            { graphql } as unknown as LeetCodeCN,
            new Credential()
        );

        const result = await service.searchProblems(
            undefined,
            undefined,
            undefined,
            10,
            0,
            "secret"
        );

        expect(result.questions[0]).toMatchObject({ paidOnly: true });
        expect(graphql.mock.calls[0][0].query).toContain("paidOnly");
    });
});

function question(paid: { isPaidOnly?: boolean; paidOnly?: boolean }) {
    return {
        title: "Premium Secret",
        titleCn: "会员题",
        titleSlug: "premium-secret",
        difficulty: "HARD",
        acRate: 10,
        topicTags: [],
        ...paid
    };
}
