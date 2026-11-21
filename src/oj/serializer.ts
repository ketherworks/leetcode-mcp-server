import { createHash } from "node:crypto";
import { LeetCodeSite } from "../cli.js";
import {
    OjCapabilities,
    ojCapabilitiesSchema,
    OjCapabilityName,
    ojCapabilityNames,
    OjProblemDocument,
    ojProblemDocumentSchema,
    OjProblemRef,
    ojProblemRefSchema,
    OjProviderHealth,
    ojProviderHealthSchema,
    OjSearchResult,
    ojSearchResultSchema,
    OjSourceRef,
    ojSourceRefSchema
} from "./contracts.js";
import {
    LeetCodeAdapterErrorCode,
    PROTOCOL_VERSION,
    PROVIDER_ID,
    PROVIDER_VERSION
} from "./errors.js";
import {
    AuditedPublicProblem,
    AuditedPublicSearchPage,
    AuditedTag,
    MAX_CURSOR_OFFSET
} from "./policy-guard.js";
import { getLeetCodeSiteDescriptor } from "./transport.js";

export const MAX_STATEMENT_CHARS = 20_000;
export const MAX_STARTER_CODE_CHARS = 20_000;

export type ProviderObservation =
    | { state: "success"; checkedAt: string }
    | { state: "error"; checkedAt: string; code: LeetCodeAdapterErrorCode };

export function normalizeAcceptanceRatio(value: number): number {
    const ratio = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, ratio));
}

export function normalizePlatformTags(
    tags: AuditedTag[],
    site: LeetCodeSite
): Array<{
    namespace: "platform";
    id?: string;
    slug: string;
    name: string;
}> {
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

export class OjContractSerializer {
    serializeSourceRef(
        site: LeetCodeSite,
        fetchedAt: string,
        rawRef?: string
    ): OjSourceRef {
        const descriptor = getLeetCodeSiteDescriptor(site);
        return ojSourceRefSchema.parse({
            kind: "community_adapter",
            adapterId: PROVIDER_ID,
            adapterVersion: PROVIDER_VERSION,
            fetchedAt,
            sourceUrl: descriptor.problemsetUrl,
            rawRef,
            confidence: "derived"
        });
    }

    serializeProblemRef(
        site: LeetCodeSite,
        nativeId: string,
        source: OjSourceRef
    ): OjProblemRef {
        const descriptor = getLeetCodeSiteDescriptor(site);
        return ojProblemRefSchema.parse({
            schemaVersion: "oj.problem-ref/v1",
            platform: "leetcode",
            site,
            nativeId,
            canonicalId: descriptor.canonicalId(nativeId),
            url: descriptor.problemUrl(nativeId),
            source
        });
    }

    serializeCapabilities(
        site: LeetCodeSite,
        checkedAt: string
    ): OjCapabilities {
        const operations = Object.fromEntries(
            ojCapabilityNames.map((name) => [
                name,
                serializeCapabilityEntry(name, checkedAt)
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
            source: this.serializeSourceRef(site, checkedAt)
        });
    }

    serializeHealth(
        checkedAt: string,
        observation?: ProviderObservation
    ): OjProviderHealth {
        if (!observation) {
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

        if (observation.state === "success") {
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

        const code = observation.code;
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

    serializeSearchResult(params: {
        site: LeetCodeSite;
        requestId: string;
        query: string;
        offset: number;
        page: AuditedPublicSearchPage;
        fetchedAt: string;
    }): OjSearchResult {
        const { site, requestId, query, offset, page, fetchedAt } = params;
        const items = page.items.map((problem) => {
            const source = this.serializeSourceRef(
                site,
                fetchedAt,
                problem.titleSlug
            );
            return {
                schemaVersion: "oj.problem-summary/v1" as const,
                ref: this.serializeProblemRef(site, problem.titleSlug, source),
                title:
                    site === "cn" && problem.titleCn
                        ? problem.titleCn
                        : problem.title,
                difficulty: problem.difficulty
                    ? {
                          scale: "leetcode-difficulty",
                          label: problem.difficulty.toUpperCase()
                      }
                    : undefined,
                tags: normalizePlatformTags(problem.topicTags, site),
                acceptance:
                    problem.acRate === undefined
                        ? undefined
                        : {
                              ratio: normalizeAcceptanceRatio(problem.acRate)
                          },
                source
            };
        });

        const nextOffset = offset + page.rawQuestionCount;
        const hasMore = page.hasMore ?? page.total > nextOffset;

        return ojSearchResultSchema.parse({
            schemaVersion: "oj.search-result/v1",
            requestId,
            items,
            nextCursor:
                hasMore &&
                page.rawQuestionCount > 0 &&
                nextOffset <= MAX_CURSOR_OFFSET
                    ? `v1:${nextOffset}`
                    : undefined,
            source: this.serializeSourceRef(site, fetchedAt, query)
        });
    }

    serializeProblemDocument(params: {
        site: LeetCodeSite;
        problem: AuditedPublicProblem;
        fetchedAt: string;
    }): OjProblemDocument {
        const { site, problem, fetchedAt } = params;
        const descriptor = getLeetCodeSiteDescriptor(site);
        const source = this.serializeSourceRef(
            site,
            fetchedAt,
            problem.nativeId
        );
        const text = problem.statement.slice(0, MAX_STATEMENT_CHARS);
        const truncated = text.length < problem.statement.length;

        return ojProblemDocumentSchema.parse({
            schemaVersion: "oj.problem-document/v1",
            ref: this.serializeProblemRef(site, problem.nativeId, source),
            title: problem.title,
            locale: descriptor.locale,
            access: "public",
            difficulty: problem.difficulty
                ? {
                      scale: "leetcode-difficulty",
                      label: problem.difficulty.toUpperCase()
                  }
                : undefined,
            tags: normalizePlatformTags(problem.topicTags, site),
            content: {
                statement: {
                    text,
                    format: "html",
                    locale: descriptor.locale,
                    truncated,
                    originalChars: truncated
                        ? problem.statement.length
                        : undefined,
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
                code: snippet.code.slice(0, MAX_STARTER_CODE_CHARS)
            })),
            source
        });
    }
}

function serializeCapabilityEntry(name: OjCapabilityName, checkedAt: string) {
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
