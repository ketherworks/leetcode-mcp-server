import { z } from "zod";

export const ojCapabilityNames = [
    "searchProblems",
    "fetchProblem",
    "importProblem",
    "fetchProfile",
    "listSubmissions",
    "localRun",
    "platformRun",
    "prepareSubmission",
    "commitSubmission",
    "pollSubmission"
] as const;

const ojCapabilityNameSchema = z.enum(ojCapabilityNames);
const isoDateSchema = z.string().datetime();

export const ojSourceRefSchema = z
    .object({
        kind: z.enum([
            "official_api",
            "official_open_platform",
            "page_adapter",
            "browser_companion",
            "community_adapter",
            "manual"
        ]),
        adapterId: z.string().min(1),
        adapterVersion: z.string().min(1),
        fetchedAt: isoDateSchema,
        sourceUrl: z.string().url(),
        etag: z.string().min(1).optional(),
        rawRef: z.string().min(1).optional(),
        confidence: z.enum(["authoritative", "derived", "user_supplied"])
    })
    .strict();

export const ojProblemRefSchema = z
    .object({
        schemaVersion: z.literal("oj.problem-ref/v1"),
        platform: z.literal("leetcode"),
        site: z.enum(["global", "cn"]),
        nativeId: z.string().min(1),
        canonicalId: z.string().min(1),
        url: z.string().url(),
        source: ojSourceRefSchema
    })
    .strict();

const ojDifficultySchema = z
    .object({
        scale: z.string().min(1),
        value: z.number().finite().optional(),
        label: z.string().min(1).optional()
    })
    .strict();

const ojTagSchema = z
    .object({
        namespace: z.enum(["platform", "canonical"]),
        id: z.string().min(1).optional(),
        slug: z.string().min(1),
        name: z.string().min(1)
    })
    .strict();

export const ojProblemSummarySchema = z
    .object({
        schemaVersion: z.literal("oj.problem-summary/v1"),
        ref: ojProblemRefSchema,
        title: z.string().min(1),
        difficulty: ojDifficultySchema.optional(),
        tags: z.array(ojTagSchema),
        acceptance: z
            .object({
                accepted: z.number().int().nonnegative().optional(),
                submissions: z.number().int().nonnegative().optional(),
                ratio: z.number().min(0).max(1).optional()
            })
            .strict()
            .optional(),
        source: ojSourceRefSchema
    })
    .strict();

export const ojTextBlockSchema = z
    .object({
        text: z.string(),
        format: z.enum(["markdown", "html", "text"]),
        locale: z.string().min(1),
        truncated: z.boolean(),
        originalChars: z.number().int().nonnegative().optional(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/)
    })
    .strict();

export const ojProblemDocumentSchema = z
    .object({
        schemaVersion: z.literal("oj.problem-document/v1"),
        ref: ojProblemRefSchema,
        title: z.string().min(1),
        locale: z.string().min(1),
        access: z.enum([
            "public",
            "auth_required",
            "premium",
            "contest_only",
            "unknown"
        ]),
        difficulty: ojDifficultySchema.optional(),
        tags: z.array(ojTagSchema),
        content: z.object({ statement: ojTextBlockSchema }).strict(),
        constraints: z.array(z.string()),
        samples: z.array(
            z
                .object({
                    ordinal: z.number().int().positive(),
                    input: z.string(),
                    output: z.string(),
                    explanation: z.string().optional()
                })
                .strict()
        ),
        limits: z
            .object({
                timeMs: z.number().positive().optional(),
                memoryBytes: z.number().int().positive().optional()
            })
            .strict(),
        io: z
            .object({
                mode: z.enum([
                    "stdin_stdout",
                    "function",
                    "file",
                    "interactive"
                ])
            })
            .strict(),
        starterCode: z.array(
            z
                .object({
                    languageKey: z.string().min(1),
                    platformLanguageId: z.string().min(1),
                    code: z.string()
                })
                .strict()
        ),
        source: ojSourceRefSchema
    })
    .strict();

export const leetCodeSearchInputSchema = z
    .object({
        schemaVersion: z.literal("oj.search-request/v1"),
        requestId: z.string().min(1).max(128),
        platform: z.literal("leetcode"),
        query: z.string().trim().min(1).max(200),
        locale: z.enum(["en-US", "zh-CN"]).optional(),
        cursor: z.string().min(1).max(32).optional(),
        limit: z.number().int().min(1).max(50)
    })
    .strict();

export const leetCodeFetchInputSchema = ojProblemRefSchema;

export const ojSearchResultSchema = z
    .object({
        schemaVersion: z.literal("oj.search-result/v1"),
        requestId: z.string().min(1).max(128),
        items: z.array(ojProblemSummarySchema),
        nextCursor: z.string().min(1).optional(),
        source: ojSourceRefSchema
    })
    .strict();

const ojCapabilitySchema = z
    .object({
        name: ojCapabilityNameSchema,
        status: z.enum([
            "available",
            "auth_required",
            "unsupported",
            "disabled_by_policy",
            "degraded"
        ]),
        toolName: z.string().min(1).optional(),
        transport: z.literal("local_stdio"),
        auth: z.enum([
            "none",
            "oauth2",
            "api_key",
            "session_cookie",
            "browser"
        ]),
        risk: z.enum([
            "R0_public_read",
            "R1_private_read",
            "R2_local_execute",
            "R3_prepare_write",
            "R4_real_submit"
        ]),
        compliance: z.enum(["official", "unofficial", "restricted", "unknown"]),
        reason: z.string().min(1).optional(),
        checkedAt: isoDateSchema
    })
    .strict();

export const ojCapabilitiesSchema = z
    .object({
        schemaVersion: z.literal("oj.capabilities/v1"),
        providerId: z.string().min(1),
        providerVersion: z.string().min(1),
        platform: z.literal("leetcode"),
        protocolVersion: z.string().min(1),
        operations: z.record(ojCapabilityNameSchema, ojCapabilitySchema),
        languages: z.array(
            z
                .object({
                    languageKey: z.string().min(1),
                    platformLanguageId: z.string().min(1),
                    displayName: z.string().min(1)
                })
                .strict()
        ),
        source: ojSourceRefSchema
    })
    .strict();

export const ojProviderHealthSchema = z
    .object({
        schemaVersion: z.literal("oj.provider-health/v1"),
        providerId: z.string().min(1),
        platform: z.literal("leetcode"),
        checkedAt: isoDateSchema,
        overall: z.enum([
            "healthy",
            "degraded",
            "unavailable",
            "auth_required"
        ]),
        layers: z
            .object({
                transport: z.enum(["pass", "fail"]),
                protocol: z.enum(["pass", "fail"]),
                schema: z.enum(["pass", "drift", "unknown"]),
                auth: z.enum([
                    "not_required",
                    "valid",
                    "expired",
                    "missing",
                    "challenge"
                ]),
                upstream: z.enum([
                    "pass",
                    "timeout",
                    "rate_limited",
                    "blocked",
                    "fail"
                ])
            })
            .strict(),
        message: z.string().min(1)
    })
    .strict();

export const ojErrorSchema = z
    .object({
        schemaVersion: z.literal("oj.error/v1"),
        code: z.enum([
            "request.invalid",
            "capability.unsupported",
            "policy.blocked",
            "auth.required",
            "auth.invalid",
            "auth.forbidden",
            "challenge.required",
            "resource.not_found",
            "rate_limited",
            "network.timeout",
            "upstream.unavailable",
            "upstream.schema_changed",
            "language.unsupported",
            "runner.unavailable",
            "runner.sandbox_required",
            "confirmation.required",
            "confirmation.expired",
            "confirmation.mismatch",
            "submission.closed",
            "submission.rejected",
            "submission.outcome_unknown",
            "internal"
        ]),
        layer: z.enum([
            "broker",
            "transport",
            "protocol",
            "auth",
            "upstream",
            "runner",
            "policy"
        ]),
        message: z.string().min(1),
        retryPolicy: z.enum([
            "never",
            "safe_read",
            "poll_only",
            "after_user_action"
        ]),
        userAction: z.enum([
            "none",
            "retry",
            "sign_in",
            "solve_challenge",
            "change_language",
            "open_logs"
        ]),
        platform: z.literal("leetcode").optional(),
        providerId: z.string().min(1).optional(),
        requestId: z.string().min(1).max(128).optional()
    })
    .strict();

export type OjCapabilityName = (typeof ojCapabilityNames)[number];
export type OjSourceRef = z.infer<typeof ojSourceRefSchema>;
export type OjProblemRef = z.infer<typeof ojProblemRefSchema>;
export type OjProblemSummary = z.infer<typeof ojProblemSummarySchema>;
export type OjTextBlock = z.infer<typeof ojTextBlockSchema>;
export type OjCapabilities = z.infer<typeof ojCapabilitiesSchema>;
export type OjProviderHealth = z.infer<typeof ojProviderHealthSchema>;
export type OjSearchInput = z.input<typeof leetCodeSearchInputSchema>;
export type OjFetchInput = z.input<typeof leetCodeFetchInputSchema>;
export type OjSearchResult = z.infer<typeof ojSearchResultSchema>;
export type OjProblemDocument = z.infer<typeof ojProblemDocumentSchema>;
export type OjError = z.infer<typeof ojErrorSchema>;
