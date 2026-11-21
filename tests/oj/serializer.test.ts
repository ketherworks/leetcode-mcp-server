import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { LeetCodeAdapterErrorCode, toOjError } from "../../src/oj/errors.js";
import {
    normalizeAcceptanceRatio,
    normalizePlatformTags,
    OjContractSerializer
} from "../../src/oj/serializer.js";
import { FIXED_NOW } from "./fixtures.js";

describe("OJ contract serializer and error mapper", () => {
    const serializer = new OjContractSerializer();

    test("normalizes acceptance ratios from percentages or ratios and clamps bounds", () => {
        expect(normalizeAcceptanceRatio(55.25)).toBeCloseTo(0.5525);
        expect(normalizeAcceptanceRatio(100)).toBe(1);
        expect(normalizeAcceptanceRatio(0.42)).toBeCloseTo(0.42);
        expect(normalizeAcceptanceRatio(0)).toBe(0);
        expect(normalizeAcceptanceRatio(150)).toBe(1);
        expect(normalizeAcceptanceRatio(-12)).toBe(0);
    });

    test("normalizes platform tags per site locale", () => {
        const tags = [
            "greedy",
            {
                id: "tag-1",
                slug: "dynamic-programming",
                name: "Dynamic Programming",
                translatedName: "动态规划"
            },
            {
                slug: "monotonic-stack"
            }
        ];

        expect(normalizePlatformTags(tags, "global")).toEqual([
            { namespace: "platform", slug: "greedy", name: "greedy" },
            {
                namespace: "platform",
                id: "tag-1",
                slug: "dynamic-programming",
                name: "Dynamic Programming"
            },
            {
                namespace: "platform",
                id: undefined,
                slug: "monotonic-stack",
                name: "monotonic-stack"
            }
        ]);

        expect(normalizePlatformTags(tags, "cn")[1]).toEqual({
            namespace: "platform",
            id: "tag-1",
            slug: "dynamic-programming",
            name: "动态规划"
        });
    });

    test("serializes provider health across initial, healthy, and all error observations", () => {
        expect(serializer.serializeHealth(FIXED_NOW)).toMatchObject({
            overall: "degraded",
            layers: { schema: "unknown", upstream: "pass" }
        });

        expect(
            serializer.serializeHealth(FIXED_NOW, {
                state: "success",
                checkedAt: FIXED_NOW
            })
        ).toMatchObject({
            overall: "healthy",
            layers: { schema: "pass", upstream: "pass" }
        });

        const matrix: Array<
            [
                LeetCodeAdapterErrorCode,
                "degraded" | "unavailable",
                "drift" | "unknown",
                "timeout" | "rate_limited" | "blocked" | "fail"
            ]
        > = [
            ["upstream.unavailable", "unavailable", "unknown", "fail"],
            ["upstream.schema_changed", "degraded", "drift", "fail"],
            ["network.timeout", "degraded", "unknown", "timeout"],
            ["rate_limited", "degraded", "unknown", "rate_limited"],
            ["policy.blocked", "degraded", "unknown", "blocked"],
            ["resource.not_found", "degraded", "unknown", "fail"]
        ];

        for (const [code, overall, schema, upstream] of matrix) {
            expect(
                serializer.serializeHealth(FIXED_NOW, {
                    state: "error",
                    checkedAt: FIXED_NOW,
                    code
                })
            ).toMatchObject({
                overall,
                layers: {
                    transport: "pass",
                    protocol: "pass",
                    auth: "not_required",
                    schema,
                    upstream
                }
            });
        }
    });

    test("serializes search results with CN titles and never emits an out-of-bounds nextCursor", () => {
        const withinBounds = serializer.serializeSearchResult({
            site: "cn",
            requestId: "cn-search-1",
            query: "两数",
            offset: 9_990,
            fetchedAt: FIXED_NOW,
            page: {
                total: 20_000,
                hasMore: true,
                rawQuestionCount: 10,
                items: [
                    {
                        title: "Two Sum",
                        titleCn: "两数之和",
                        titleSlug: "two-sum",
                        difficulty: "Easy",
                        acRate: 0.55,
                        topicTags: ["array"]
                    }
                ]
            }
        });
        expect(withinBounds.items[0].title).toBe("两数之和");
        expect(withinBounds.items[0].ref.site).toBe("cn");
        expect(withinBounds.nextCursor).toBe("v1:10000");

        const beyondMaxOffset = serializer.serializeSearchResult({
            site: "cn",
            requestId: "cn-search-cap",
            query: "两数",
            offset: 10_000,
            fetchedAt: FIXED_NOW,
            page: {
                total: 20_000,
                hasMore: true,
                rawQuestionCount: 10,
                items: []
            }
        });
        expect(beyondMaxOffset.nextCursor).toBeUndefined();
    });

    test("truncates oversized statements and starter code while computing SHA-256 on emitted text", () => {
        const longStatement = "<p>" + "a".repeat(25_000) + "</p>";
        const longCode = "// " + "b".repeat(22_000);
        const doc = serializer.serializeProblemDocument({
            site: "global",
            fetchedAt: FIXED_NOW,
            problem: {
                nativeId: "two-sum",
                title: "Two Sum",
                statement: longStatement,
                difficulty: "Medium",
                topicTags: ["array"],
                codeSnippets: [{ langSlug: "typescript", code: longCode }]
            }
        });

        const expectedText = longStatement.slice(0, 20_000);
        const expectedSha = createHash("sha256")
            .update(expectedText, "utf8")
            .digest("hex");

        expect(doc.content.statement).toEqual({
            text: expectedText,
            format: "html",
            locale: "en-US",
            truncated: true,
            originalChars: longStatement.length,
            sha256: expectedSha
        });
        expect(doc.starterCode[0].code).toHaveLength(20_000);
    });

    test("maps adapter and internal error codes to strict oj.error/v1 contracts", () => {
        expect(
            toOjError("network.timeout", "Timed out.", "req-timeout")
        ).toMatchObject({
            schemaVersion: "oj.error/v1",
            code: "network.timeout",
            layer: "transport",
            retryPolicy: "safe_read",
            userAction: "retry",
            requestId: "req-timeout"
        });

        expect(toOjError("policy.blocked", "Premium excluded.")).toMatchObject({
            code: "policy.blocked",
            layer: "policy",
            retryPolicy: "never",
            userAction: "none"
        });

        expect(
            toOjError("upstream.schema_changed", "Schema drifted.")
        ).toMatchObject({
            code: "upstream.schema_changed",
            layer: "upstream",
            retryPolicy: "never",
            userAction: "open_logs"
        });

        expect(
            toOjError("internal", "Internal failure.", "req-int")
        ).toMatchObject({
            code: "internal",
            layer: "broker",
            retryPolicy: "never",
            userAction: "open_logs",
            requestId: "req-int"
        });
    });
});
