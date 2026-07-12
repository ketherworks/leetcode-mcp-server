import { createHash } from "node:crypto";
import { z } from "zod";
import { LeetCodeSite } from "../cli.js";
import {
    leetCodeFetchInputSchema,
    leetCodeSearchInputSchema,
    OjCapabilities,
    ojCapabilitiesSchema,
    OjCapabilityName,
    ojCapabilityNames,
    OjFetchInput,
    OjProblemDocument,
    ojProblemDocumentSchema,
    OjProviderHealth,
    ojProviderHealthSchema,
    OjSearchInput,
    OjSearchResult,
    ojSearchResultSchema
} from "./contracts.js";
import { AnonymousLeetCodeService } from "./service.js";

const PROVIDER_ID = "leetcode-query-anonymous-adapter";
const PROVIDER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2025-11-25";
const MAX_STATEMENT_CHARS = 20_000;

const searchResponseSchema = z
    .object({
        hasMore: z.boolean().optional(),
        total: z.number().int().nonnegative(),
        questions: z
            .array(
                z
                    .object({
                        title: z.string().min(1),
                        titleCn: z.string().min(1).optional(),
                        titleSlug: z
                            .string()
                            .min(1)
                            .max(128)
                            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
                        difficulty: z.string().min(1).optional(),
                        acRate: z.number().finite().optional(),
                        topicTags: z
                            .array(z.string().min(1))
                            .max(50)
                            .default([]),
                        paidOnly: z.boolean().optional(),
                        isPaidOnly: z.boolean().optional()
                    })
                    .passthrough()
            )
            .max(50)
    })
    .passthrough();

const rawTagSchema = z.union([
    z.string().min(1),
    z
        .object({
            id: z.string().min(1).optional(),
            slug: z.string().min(1),
            name: z.string().min(1).optional(),
            translatedName: z.string().min(1).optional()
        })
        .passthrough()
]);

const rawProblemSchema = z
    .object({
        title: z.string().min(1).optional(),
        translatedTitle: z.string().min(1).nullable().optional(),
        titleSlug: z.string().min(1).optional(),
        content: z.string().nullable().optional(),
        translatedContent: z.string().nullable().optional(),
        difficulty: z.string().min(1).optional(),
        isPaidOnly: z.boolean().optional(),
        paidOnly: z.boolean().optional(),
        topicTags: z.array(rawTagSchema).max(50).default([]),
        codeSnippets: z
            .array(
                z
                    .object({
                        lang: z.string().min(1).optional(),
                        langSlug: z.string().min(1).max(64),
                        code: z.string()
                    })
                    .passthrough()
            )
            .max(50)
            .default([])
    })
    .passthrough();

type Observation =
    | { state: "success"; checkedAt: string }
    | { state: "error"; checkedAt: string; code: LeetCodeAdapterError["code"] };

export class LeetCodeAdapterError extends Error {
    constructor(
        public readonly code:
            | "request.invalid"
            | "policy.blocked"
            | "resource.not_found"
            | "network.timeout"
            | "rate_limited"
            | "upstream.unavailable"
            | "upstream.schema_changed",
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "LeetCodeAdapterError";
    }
}

export interface LeetCodeOjProviderOptions {
    service: AnonymousLeetCodeService;
    site: LeetCodeSite;
    nowIso?: () => string;
}

export class LeetCodeOjProvider {
    private readonly service: AnonymousLeetCodeService;
    private readonly site: LeetCodeSite;
    private readonly nowIso: () => string;
    private observation?: Observation;

    constructor(options: LeetCodeOjProviderOptions) {
        if (options.service.isAuthenticated()) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
        this.service = options.service;
        this.site = options.site;
        this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    }

    async getCapabilities(): Promise<OjCapabilities> {
        const checkedAt = this.nowIso();
        const operations = Object.fromEntries(
            ojCapabilityNames.map((name) => [
                name,
                this.capability(name, checkedAt)
            ])
        ) as OjCapabilities["operations"];
        return ojCapabilitiesSchema.parse({
            schemaVersion: "oj.capabilities/v1",
            providerId: PROVIDER_ID,
            providerVersion: PROVIDER_VERSION,
            platform: "leetcode",
            protocolVersion: PROTOCOL_VERSION,
            operations,
            languages: [],
            source: this.source(checkedAt)
        });
    }

    async getHealth(): Promise<OjProviderHealth> {
        const checkedAt = this.nowIso();
        if (!this.observation) {
            return ojProviderHealthSchema.parse({
                schemaVersion: "oj.provider-health/v1",
                providerId: PROVIDER_ID,
                platform: "leetcode",
                checkedAt,
                overall: "degraded",
                layers: {
                    transport: "pass",
                    protocol: "pass",
                    schema: "unknown",
                    auth: "not_required",
                    upstream: "pass"
                },
                message:
                    "Local anonymous adapter is ready; no upstream read has been observed."
            });
        }
        if (this.observation.state === "success") {
            return ojProviderHealthSchema.parse({
                schemaVersion: "oj.provider-health/v1",
                providerId: PROVIDER_ID,
                platform: "leetcode",
                checkedAt,
                overall: "healthy",
                layers: {
                    transport: "pass",
                    protocol: "pass",
                    schema: "pass",
                    auth: "not_required",
                    upstream: "pass"
                },
                message:
                    "The latest anonymous LeetCode read matched the adapter schema."
            });
        }
        const code = this.observation.code;
        return ojProviderHealthSchema.parse({
            schemaVersion: "oj.provider-health/v1",
            providerId: PROVIDER_ID,
            platform: "leetcode",
            checkedAt,
            overall:
                code === "upstream.unavailable" ? "unavailable" : "degraded",
            layers: {
                transport: "pass",
                protocol: "pass",
                schema:
                    code === "upstream.schema_changed" ? "drift" : "unknown",
                auth: "not_required",
                upstream:
                    code === "network.timeout"
                        ? "timeout"
                        : code === "rate_limited"
                          ? "rate_limited"
                          : code === "policy.blocked"
                            ? "blocked"
                            : "fail"
            },
            message:
                "The latest anonymous LeetCode read did not complete successfully."
        });
    }

    async search(input: OjSearchInput): Promise<OjSearchResult> {
        const parsedInput = leetCodeSearchInputSchema.safeParse(input);
        if (!parsedInput.success) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "LeetCode search input did not match its strict bounded schema."
            );
        }
        this.assertLocale(parsedInput.data.locale);
        const offset = parseCursor(parsedInput.data.cursor);
        try {
            const raw = await this.service.searchProblems(
                "all-code-essentials",
                undefined,
                undefined,
                parsedInput.data.limit,
                offset,
                parsedInput.data.query
            );
            const parsed = searchResponseSchema.safeParse(raw);
            if (!parsed.success) {
                throw new LeetCodeAdapterError(
                    "upstream.schema_changed",
                    "LeetCode search response no longer matches the audited adapter schema.",
                    { cause: parsed.error }
                );
            }
            const fetchedAt = this.nowIso();
            const auditedQuestions = parsed.data.questions.map((problem) => ({
                problem,
                paidOnly: requirePaidMarker(problem, this.site)
            }));
            const items = auditedQuestions
                .filter(({ paidOnly }) => !paidOnly)
                .map(({ problem }) => {
                    const source = this.source(fetchedAt, problem.titleSlug);
                    return {
                        schemaVersion: "oj.problem-summary/v1" as const,
                        ref: this.problemRef(problem.titleSlug, source),
                        title:
                            this.site === "cn" && problem.titleCn
                                ? problem.titleCn
                                : problem.title,
                        difficulty: problem.difficulty
                            ? {
                                  scale: "leetcode-difficulty",
                                  label: problem.difficulty.toUpperCase()
                              }
                            : undefined,
                        tags: problem.topicTags.map((tag) => ({
                            namespace: "platform" as const,
                            slug: tag,
                            name: tag
                        })),
                        acceptance:
                            problem.acRate === undefined
                                ? undefined
                                : {
                                      ratio: normalizeAcceptance(problem.acRate)
                                  },
                        source
                    };
                });
            const nextOffset = offset + parsed.data.questions.length;
            const hasMore =
                parsed.data.hasMore ?? parsed.data.total > nextOffset;
            const result = ojSearchResultSchema.parse({
                schemaVersion: "oj.search-result/v1",
                requestId: parsedInput.data.requestId,
                items,
                nextCursor:
                    hasMore && parsed.data.questions.length > 0
                        ? `v1:${nextOffset}`
                        : undefined,
                source: this.source(fetchedAt, parsedInput.data.query)
            });
            this.observation = { state: "success", checkedAt: fetchedAt };
            return result;
        } catch (error) {
            throw this.recordAndMapError(error);
        }
    }

    async fetchProblem(input: OjFetchInput): Promise<OjProblemDocument> {
        const parsedInput = leetCodeFetchInputSchema.safeParse(input);
        if (!parsedInput.success) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "LeetCode fetch input did not match its strict bounded schema."
            );
        }
        this.assertProblemRef(parsedInput.data);
        try {
            const raw = await this.service.fetchProblem(
                parsedInput.data.nativeId
            );
            if (!raw) {
                throw new LeetCodeAdapterError(
                    "resource.not_found",
                    "The requested LeetCode problem was not found."
                );
            }
            const parsed = rawProblemSchema.safeParse(raw);
            if (!parsed.success) {
                throw new LeetCodeAdapterError(
                    "upstream.schema_changed",
                    "LeetCode problem response no longer matches the audited adapter schema.",
                    { cause: parsed.error }
                );
            }
            const problem = parsed.data;
            if (requirePaidMarker(problem, this.site)) {
                throw new LeetCodeAdapterError(
                    "policy.blocked",
                    "Premium LeetCode problem content is excluded by adapter policy."
                );
            }
            if (
                problem.titleSlug &&
                problem.titleSlug !== parsedInput.data.nativeId
            ) {
                throw new LeetCodeAdapterError(
                    "upstream.schema_changed",
                    "LeetCode returned a problem identifier that did not match the request."
                );
            }
            const title =
                this.site === "cn" && problem.translatedTitle
                    ? problem.translatedTitle
                    : problem.title;
            const statement =
                this.site === "cn" && problem.translatedContent
                    ? problem.translatedContent
                    : problem.content;
            if (!title || !statement) {
                throw new LeetCodeAdapterError(
                    "upstream.schema_changed",
                    "LeetCode problem response did not contain a public title and statement."
                );
            }
            const fetchedAt = this.nowIso();
            const source = this.source(fetchedAt, parsedInput.data.nativeId);
            const text = statement.slice(0, MAX_STATEMENT_CHARS);
            const truncated = text.length < statement.length;
            const result = ojProblemDocumentSchema.parse({
                schemaVersion: "oj.problem-document/v1",
                ref: this.problemRef(parsedInput.data.nativeId, source),
                title,
                locale: this.locale,
                access: "public",
                difficulty: problem.difficulty
                    ? {
                          scale: "leetcode-difficulty",
                          label: problem.difficulty.toUpperCase()
                      }
                    : undefined,
                tags: normalizeTags(problem.topicTags, this.site),
                content: {
                    statement: {
                        text,
                        format: "html",
                        locale: this.locale,
                        truncated,
                        originalChars: truncated ? statement.length : undefined,
                        sha256: createHash("sha256")
                            .update(text, "utf8")
                            .digest("hex")
                    }
                },
                constraints: [],
                samples: [],
                limits: {},
                io: { mode: "function" },
                starterCode: problem.codeSnippets.map((snippet) => ({
                    languageKey: snippet.langSlug,
                    platformLanguageId: snippet.langSlug,
                    code: snippet.code.slice(0, 20_000)
                })),
                source
            });
            this.observation = { state: "success", checkedAt: fetchedAt };
            return result;
        } catch (error) {
            throw this.recordAndMapError(error);
        }
    }

    private capability(name: OjCapabilityName, checkedAt: string) {
        const available = name === "searchProblems" || name === "fetchProblem";
        const unsupported = name === "importProblem" || name === "localRun";
        return {
            name,
            status: available
                ? ("available" as const)
                : unsupported
                  ? ("unsupported" as const)
                  : ("disabled_by_policy" as const),
            toolName:
                name === "searchProblems"
                    ? "oj_search_problems"
                    : name === "fetchProblem"
                      ? "oj_fetch_problem"
                      : undefined,
            transport: "local_stdio" as const,
            auth: capabilityAuth(name),
            risk: capabilityRisk(name),
            compliance: available
                ? ("unofficial" as const)
                : ("restricted" as const),
            reason: available
                ? "Anonymous use of the unofficial leetcode-query adapter; endpoint stability is not guaranteed."
                : "This private package exposes only anonymous problem search and fetch operations.",
            checkedAt
        };
    }

    private source(fetchedAt: string, rawRef?: string) {
        return {
            kind: "community_adapter" as const,
            adapterId: PROVIDER_ID,
            adapterVersion: PROVIDER_VERSION,
            fetchedAt,
            sourceUrl: `${this.origin}/problemset/`,
            rawRef,
            confidence: "derived" as const
        };
    }

    private problemRef(
        nativeId: string,
        source: ReturnType<LeetCodeOjProvider["source"]>
    ) {
        return {
            schemaVersion: "oj.problem-ref/v1" as const,
            platform: "leetcode" as const,
            site: this.site,
            nativeId,
            canonicalId: `leetcode:${this.site}:${nativeId}`,
            url: `${this.origin}/problems/${encodeURIComponent(nativeId)}/`,
            source
        };
    }

    private assertLocale(locale: string | undefined): void {
        if (locale !== undefined && locale !== this.locale) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                `Locale must match the configured LeetCode site.`
            );
        }
    }

    private assertProblemRef(ref: OjFetchInput): void {
        if (ref.site !== this.site) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "Problem reference site must match the configured LeetCode site."
            );
        }
        const expectedCanonicalId = `leetcode:${this.site}:${ref.nativeId}`;
        const expectedUrl = `${this.origin}/problems/${encodeURIComponent(ref.nativeId)}/`;
        if (
            ref.canonicalId !== expectedCanonicalId ||
            ref.url !== expectedUrl
        ) {
            throw new LeetCodeAdapterError(
                "request.invalid",
                "Problem reference identity does not match its LeetCode site and slug."
            );
        }
    }

    private recordAndMapError(error: unknown): LeetCodeAdapterError {
        const mapped = mapServiceError(error);
        this.observation = {
            state: "error",
            checkedAt: this.nowIso(),
            code: mapped.code
        };
        return mapped;
    }

    private get origin(): string {
        return this.site === "cn"
            ? "https://leetcode.cn"
            : "https://leetcode.com";
    }

    private get locale(): "en-US" | "zh-CN" {
        return this.site === "cn" ? "zh-CN" : "en-US";
    }
}

function parseCursor(cursor: string | undefined): number {
    if (!cursor) {
        return 0;
    }
    const match = /^v1:(0|[1-9]\d{0,4})$/.exec(cursor);
    if (!match) {
        throw new LeetCodeAdapterError(
            "request.invalid",
            "LeetCode search cursor is outside the supported bounds."
        );
    }
    const offset = Number(match[1]);
    if (offset > 10_000) {
        throw new LeetCodeAdapterError(
            "request.invalid",
            "LeetCode search cursor is outside the supported bounds."
        );
    }
    return offset;
}

function normalizeAcceptance(value: number): number {
    const ratio = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, ratio));
}

function requirePaidMarker(
    value: { isPaidOnly?: boolean; paidOnly?: boolean },
    site: LeetCodeSite
): boolean {
    const marker = site === "cn" ? value.paidOnly : value.isPaidOnly;
    if (typeof marker !== "boolean") {
        throw new LeetCodeAdapterError(
            "upstream.schema_changed",
            "LeetCode response omitted the audited Premium access marker."
        );
    }
    return marker;
}

function normalizeTags(
    tags: Array<z.infer<typeof rawTagSchema>>,
    site: LeetCodeSite
) {
    return tags.map((tag) => {
        if (typeof tag === "string") {
            return { namespace: "platform" as const, slug: tag, name: tag };
        }
        return {
            namespace: "platform" as const,
            id: tag.id,
            slug: tag.slug,
            name:
                site === "cn" && tag.translatedName
                    ? tag.translatedName
                    : (tag.name ?? tag.slug)
        };
    });
}

function capabilityAuth(name: OjCapabilityName) {
    return name === "listSubmissions" ||
        name === "platformRun" ||
        name === "prepareSubmission" ||
        name === "commitSubmission" ||
        name === "pollSubmission"
        ? ("session_cookie" as const)
        : ("none" as const);
}

function capabilityRisk(name: OjCapabilityName) {
    if (
        name === "fetchProfile" ||
        name === "listSubmissions" ||
        name === "pollSubmission"
    ) {
        return "R1_private_read" as const;
    }
    if (name === "localRun" || name === "platformRun") {
        return "R2_local_execute" as const;
    }
    if (name === "prepareSubmission") {
        return "R3_prepare_write" as const;
    }
    if (name === "commitSubmission") {
        return "R4_real_submit" as const;
    }
    return "R0_public_read" as const;
}

function mapServiceError(error: unknown): LeetCodeAdapterError {
    if (error instanceof LeetCodeAdapterError) {
        return error;
    }
    const message = error instanceof Error ? error.message : "";
    if (/not found/i.test(message)) {
        return new LeetCodeAdapterError(
            "resource.not_found",
            "The requested LeetCode problem was not found."
        );
    }
    if (/timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(message)) {
        return new LeetCodeAdapterError(
            "network.timeout",
            "The anonymous LeetCode read timed out."
        );
    }
    if (/429|rate.?limit/i.test(message)) {
        return new LeetCodeAdapterError(
            "rate_limited",
            "The anonymous LeetCode read was rate limited."
        );
    }
    return new LeetCodeAdapterError(
        "upstream.unavailable",
        "The anonymous LeetCode read failed without exposing upstream data."
    );
}
