import { describe, expect, test } from "vitest";
import {
    evaluatePremiumAccess,
    LeetCodePolicyGuard,
    parseBoundedCursor
} from "../../src/oj/policy-guard.js";
import {
    premiumProblemFixture,
    problemRef,
    publicProblemFixture
} from "./fixtures.js";

describe("LeetCode fail-closed policy guard", () => {
    const guard = new LeetCodePolicyGuard();

    test.each([
        [undefined, 0],
        ["v1:0", 0],
        ["v1:1", 1],
        ["v1:250", 250],
        ["v1:10000", 10_000]
    ])("parses valid bounded cursor %s -> %d", (cursor, expected) => {
        expect(parseBoundedCursor(cursor)).toBe(expected);
    });

    test.each([
        "v1:10001",
        "v1:99999",
        "v1:-1",
        "v1:00",
        "v1:01",
        "v2:10",
        "10",
        "v1:10 "
    ])("rejects out-of-bounds or malformed cursor %s", (cursor) => {
        expect(() => parseBoundedCursor(cursor)).toThrowError(
            expect.objectContaining({ code: "request.invalid" })
        );
    });

    test("evaluates Premium access fail-closed across Global/CN and search/fetch", () => {
        expect(
            evaluatePremiumAccess({ isPaidOnly: false }, "global", "search")
        ).toBe("public");
        expect(
            evaluatePremiumAccess({ isPaidOnly: true }, "global", "search")
        ).toBe("premium");
        expect(evaluatePremiumAccess({ paidOnly: false }, "cn", "search")).toBe(
            "public"
        );
        expect(evaluatePremiumAccess({ paidOnly: true }, "cn", "search")).toBe(
            "premium"
        );
        expect(
            evaluatePremiumAccess({ isPaidOnly: false }, "cn", "fetch")
        ).toBe("public");
        expect(evaluatePremiumAccess({ isPaidOnly: true }, "cn", "fetch")).toBe(
            "premium"
        );

        // Wrong site marker or non-boolean values must fail closed
        expect(() =>
            evaluatePremiumAccess({ paidOnly: false }, "global", "search")
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
        expect(() =>
            evaluatePremiumAccess({ isPaidOnly: false }, "cn", "search")
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
        expect(() =>
            evaluatePremiumAccess(
                { isPaidOnly: null as unknown as boolean },
                "global",
                "fetch"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
        expect(() =>
            evaluatePremiumAccess(
                { isPaidOnly: "false" as unknown as boolean },
                "global",
                "fetch"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );

        // Contradictory or malformed secondary markers must also fail closed
        expect(() =>
            evaluatePremiumAccess(
                { isPaidOnly: false, paidOnly: true },
                "global",
                "fetch"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
        expect(() =>
            evaluatePremiumAccess(
                { paidOnly: false, isPaidOnly: true },
                "cn",
                "search"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
        expect(() =>
            evaluatePremiumAccess(
                { isPaidOnly: false, paidOnly: "0" },
                "global",
                "search"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
    });

    test("validates search locale and fetch problem reference boundaries", () => {
        expect(() =>
            guard.validateSearchRequest(
                {
                    schemaVersion: "oj.search-request/v1",
                    requestId: "req-1",
                    platform: "leetcode",
                    query: "two sum",
                    locale: "zh-CN",
                    limit: 5
                },
                "global"
            )
        ).toThrowError(expect.objectContaining({ code: "request.invalid" }));

        expect(() =>
            guard.validateFetchRequest(problemRef("two-sum", "cn"), "global")
        ).toThrowError(expect.objectContaining({ code: "request.invalid" }));

        // Unsafe slug / traversal attempt even with matching canonicalId & url
        const unsafeSlug = "Two-Sum";
        expect(() =>
            guard.validateFetchRequest(
                {
                    ...problemRef("two-sum", "global"),
                    nativeId: unsafeSlug,
                    canonicalId: `leetcode:global:${unsafeSlug}`,
                    url: `https://leetcode.com/problems/${unsafeSlug}/`
                },
                "global"
            )
        ).toThrowError(expect.objectContaining({ code: "request.invalid" }));
    });

    test("fails closed for the entire search page if any item omits its paid marker", () => {
        expect(() =>
            guard.guardSearchPage(
                {
                    total: 2,
                    questions: [
                        {
                            title: "Two Sum",
                            titleSlug: "two-sum",
                            topicTags: ["array"],
                            isPaidOnly: false
                        },
                        {
                            title: "Unmarked Secret",
                            titleSlug: "unmarked-secret",
                            topicTags: []
                        }
                    ]
                },
                "global"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
    });

    test("blocks real-world anonymous Premium payloads where content and codeSnippets are null", () => {
        const realisticLockedPayload = {
            questionId: "9999",
            title: "Locked Premium Problem",
            translatedTitle: null,
            titleSlug: "locked-premium-problem",
            content: null,
            translatedContent: null,
            difficulty: "Hard",
            isPaidOnly: true,
            topicTags: [{ name: "Array", slug: "array", translatedName: null }],
            codeSnippets: null,
            hints: ["SECRET_LOCKED_HINT"]
        };

        expect(() =>
            guard.guardFetchedProblem(
                realisticLockedPayload,
                "locked-premium-problem",
                "global"
            )
        ).toThrowError(expect.objectContaining({ code: "policy.blocked" }));
    });

    test("accepts realistic leetcode-query public payloads with nullable tag fields and strips secrets", () => {
        const realisticPublicPayload = {
            ...publicProblemFixture,
            translatedTitle: "",
            translatedContent: null,
            topicTags: [
                {
                    id: null,
                    name: "Array",
                    slug: "array",
                    translatedName: null
                }
            ],
            codeSnippets: null
        };

        const globalAudited = guard.guardFetchedProblem(
            realisticPublicPayload,
            "two-sum",
            "global"
        );
        expect(globalAudited).toEqual({
            nativeId: "two-sum",
            title: "Two Sum",
            statement: publicProblemFixture.content,
            difficulty: "Easy",
            topicTags: [
                {
                    id: undefined,
                    slug: "array",
                    name: "Array",
                    translatedName: undefined
                }
            ],
            codeSnippets: []
        });
        expect(JSON.stringify(globalAudited)).not.toContain("SECRET_");

        // Untranslated CN problem falls back cleanly to English title and content
        const cnFallbackAudited = guard.guardFetchedProblem(
            realisticPublicPayload,
            "two-sum",
            "cn"
        );
        expect(cnFallbackAudited.title).toBe("Two Sum");
        expect(cnFallbackAudited.statement).toBe(publicProblemFixture.content);
    });

    test("rejects slug mismatch and empty public statements with upstream.schema_changed", () => {
        expect(() =>
            guard.guardFetchedProblem(
                { ...publicProblemFixture, titleSlug: "three-sum" },
                "two-sum",
                "global"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );

        expect(() =>
            guard.guardFetchedProblem(
                { ...premiumProblemFixture, isPaidOnly: false, content: "   " },
                "premium-secret",
                "global"
            )
        ).toThrowError(
            expect.objectContaining({ code: "upstream.schema_changed" })
        );
    });
});
