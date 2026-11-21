import { Credential, LeetCode, LeetCodeCN } from "leetcode-query";
import { LeetCodeSite } from "../cli.js";
import { SEARCH_PROBLEMS_QUERY as CN_SEARCH_PROBLEMS_QUERY } from "../leetcode/graphql/cn/search-problems.js";
import { SEARCH_PROBLEMS_QUERY as GLOBAL_SEARCH_PROBLEMS_QUERY } from "../leetcode/graphql/global/search-problems.js";
import { LeetCodeAdapterError } from "./errors.js";
import { AnonymousLeetCodeService } from "./service.js";

export interface LeetCodeSiteDescriptor {
    readonly site: LeetCodeSite;
    readonly origin: "https://leetcode.com" | "https://leetcode.cn";
    readonly problemsetUrl: string;
    readonly locale: "en-US" | "zh-CN";
    readonly defaultCategorySlug: string;
    readonly searchPaidMarkerField: "isPaidOnly" | "paidOnly";
    readonly fetchPaidMarkerField: "isPaidOnly";
    canonicalId(nativeId: string): string;
    problemUrl(nativeId: string): string;
}

const SITE_DESCRIPTORS: Record<LeetCodeSite, LeetCodeSiteDescriptor> = {
    global: createDescriptor(
        "global",
        "https://leetcode.com",
        "en-US",
        "isPaidOnly"
    ),
    cn: createDescriptor("cn", "https://leetcode.cn", "zh-CN", "paidOnly")
};

function createDescriptor(
    site: LeetCodeSite,
    origin: "https://leetcode.com" | "https://leetcode.cn",
    locale: "en-US" | "zh-CN",
    searchPaidMarkerField: "isPaidOnly" | "paidOnly"
): LeetCodeSiteDescriptor {
    return {
        site,
        origin,
        problemsetUrl: `${origin}/problemset/`,
        locale,
        defaultCategorySlug: "all-code-essentials",
        searchPaidMarkerField,
        fetchPaidMarkerField: "isPaidOnly",
        canonicalId: (nativeId: string) => `leetcode:${site}:${nativeId}`,
        problemUrl: (nativeId: string) =>
            `${origin}/problems/${encodeURIComponent(nativeId)}/`
    };
}

export function getLeetCodeSiteDescriptor(
    site: LeetCodeSite
): LeetCodeSiteDescriptor {
    return SITE_DESCRIPTORS[site];
}

export interface LeetCodeSearchTransportRequest {
    query: string;
    limit: number;
    offset: number;
    categorySlug?: string;
}

export interface LeetCodeQueryTransport {
    readonly site: LeetCodeSite;
    isAuthenticated(): boolean;
    searchProblems(request: LeetCodeSearchTransportRequest): Promise<unknown>;
    fetchProblem(titleSlug: string): Promise<unknown>;
}

export interface LeetCodeGraphqlQuery {
    query: string;
    variables?: Record<string, unknown>;
}

export interface LeetCodeGraphqlResponse {
    data?: Record<string, unknown> | null;
    errors?: unknown[];
}

export interface LeetCodeGraphqlClient {
    graphql(request: LeetCodeGraphqlQuery): Promise<LeetCodeGraphqlResponse>;
    problem(titleSlug: string): Promise<unknown>;
}

export interface LeetCodeCredentialLike {
    session?: string;
    csrf?: string;
}

export class ServiceLeetCodeQueryTransport implements LeetCodeQueryTransport {
    public readonly site: LeetCodeSite;
    private readonly service: AnonymousLeetCodeService;
    private readonly descriptor: LeetCodeSiteDescriptor;

    constructor(options: {
        service: AnonymousLeetCodeService;
        site: LeetCodeSite;
    }) {
        if (options.service.isAuthenticated()) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
        this.service = options.service;
        this.site = options.site;
        this.descriptor = getLeetCodeSiteDescriptor(options.site);
    }

    isAuthenticated(): boolean {
        return this.service.isAuthenticated();
    }

    async searchProblems(
        request: LeetCodeSearchTransportRequest
    ): Promise<unknown> {
        this.assertUnauthenticated();
        try {
            return await this.service.searchProblems(
                request.categorySlug ?? this.descriptor.defaultCategorySlug,
                undefined,
                undefined,
                request.limit,
                request.offset,
                request.query
            );
        } catch (error) {
            throw classifyTransportError(error);
        }
    }

    async fetchProblem(titleSlug: string): Promise<unknown> {
        this.assertUnauthenticated();
        try {
            const raw = await this.service.fetchProblem(titleSlug);
            if (!raw) {
                throw new LeetCodeAdapterError(
                    "resource.not_found",
                    "The requested LeetCode problem was not found."
                );
            }
            return raw;
        } catch (error) {
            throw classifyTransportError(error);
        }
    }

    private assertUnauthenticated(): void {
        if (this.service.isAuthenticated()) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
    }
}

export class GraphqlLeetCodeQueryTransport implements LeetCodeQueryTransport {
    public readonly site: LeetCodeSite;
    private readonly client: LeetCodeGraphqlClient;
    private readonly credential?: LeetCodeCredentialLike;
    private readonly descriptor: LeetCodeSiteDescriptor;

    constructor(options: {
        site: LeetCodeSite;
        client: LeetCodeGraphqlClient;
        credential?: LeetCodeCredentialLike;
    }) {
        if (hasSessionMaterial(options.credential)) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
        this.site = options.site;
        this.client = options.client;
        this.credential = options.credential;
        this.descriptor = getLeetCodeSiteDescriptor(options.site);
    }

    isAuthenticated(): boolean {
        return hasSessionMaterial(this.credential);
    }

    async searchProblems(
        request: LeetCodeSearchTransportRequest
    ): Promise<unknown> {
        this.assertUnauthenticated();
        const filters: Record<string, unknown> = {};
        if (request.query) {
            filters.searchKeywords = request.query;
        }
        const query =
            this.site === "cn"
                ? CN_SEARCH_PROBLEMS_QUERY
                : GLOBAL_SEARCH_PROBLEMS_QUERY;

        let response: LeetCodeGraphqlResponse;
        try {
            response = await this.client.graphql({
                query,
                variables: {
                    categorySlug:
                        request.categorySlug ??
                        this.descriptor.defaultCategorySlug,
                    limit: request.limit,
                    skip: request.offset,
                    filters
                }
            });
        } catch (error) {
            throw classifyTransportError(error);
        }

        if (Array.isArray(response?.errors) && response.errors.length > 0) {
            throw classifyGraphqlErrors(response.errors);
        }

        const questionList = response?.data?.problemsetQuestionList;
        if (
            !questionList ||
            typeof questionList !== "object" ||
            Array.isArray(questionList)
        ) {
            throw new LeetCodeAdapterError(
                "upstream.schema_changed",
                "LeetCode search response no longer matches the audited adapter schema."
            );
        }

        return questionList;
    }

    async fetchProblem(titleSlug: string): Promise<unknown> {
        this.assertUnauthenticated();
        try {
            const problem = await this.client.problem(titleSlug);
            if (!problem) {
                throw new LeetCodeAdapterError(
                    "resource.not_found",
                    "The requested LeetCode problem was not found."
                );
            }
            return problem;
        } catch (error) {
            throw classifyTransportError(error);
        }
    }

    private assertUnauthenticated(): void {
        if (this.isAuthenticated()) {
            throw new Error("Anonymous LeetCode service assertion failed.");
        }
    }
}

export function createServiceQueryTransport(options: {
    service: AnonymousLeetCodeService;
    site: LeetCodeSite;
}): ServiceLeetCodeQueryTransport {
    return new ServiceLeetCodeQueryTransport(options);
}

export function createGraphqlQueryTransport(options: {
    site: LeetCodeSite;
    client: LeetCodeGraphqlClient;
    credential?: LeetCodeCredentialLike;
}): GraphqlLeetCodeQueryTransport {
    return new GraphqlLeetCodeQueryTransport(options);
}

export function createAnonymousQueryTransport(
    site: LeetCodeSite
): GraphqlLeetCodeQueryTransport {
    const credential = new Credential();
    const client: LeetCodeGraphqlClient =
        site === "cn" ? new LeetCodeCN(credential) : new LeetCode(credential);
    return new GraphqlLeetCodeQueryTransport({ site, client, credential });
}

export function classifyTransportError(error: unknown): LeetCodeAdapterError {
    if (error instanceof LeetCodeAdapterError) {
        return error;
    }
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message : "";
    const code = extractErrorCode(error);
    const signal = `${name} ${code} ${message}`;

    if (/not found|does not exist|\b404\b/i.test(signal)) {
        return new LeetCodeAdapterError(
            "resource.not_found",
            "The requested LeetCode problem was not found."
        );
    }
    if (
        /AbortError|TimeoutError|timeout|timed out|ECONNRESET|ETIMEDOUT|ECONNABORTED|UND_ERR_CONNECT_TIMEOUT/i.test(
            signal
        )
    ) {
        return new LeetCodeAdapterError(
            "network.timeout",
            "The anonymous LeetCode read timed out."
        );
    }
    if (/\b429\b|too many requests|rate.?limit/i.test(signal)) {
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

function classifyGraphqlErrors(errors: unknown[]): LeetCodeAdapterError {
    const messages = errors
        .map((entry) =>
            entry && typeof entry === "object" && "message" in entry
                ? String((entry as { message?: unknown }).message ?? "")
                : ""
        )
        .join(" ");
    if (/\b429\b|too many requests|rate.?limit/i.test(messages)) {
        return new LeetCodeAdapterError(
            "rate_limited",
            "The anonymous LeetCode read was rate limited."
        );
    }
    if (/not found|does not exist/i.test(messages)) {
        return new LeetCodeAdapterError(
            "resource.not_found",
            "The requested LeetCode problem was not found."
        );
    }
    return new LeetCodeAdapterError(
        "upstream.unavailable",
        "The anonymous LeetCode read failed without exposing upstream data."
    );
}

function hasSessionMaterial(credential?: LeetCodeCredentialLike): boolean {
    return Boolean(credential && (credential.session || credential.csrf));
}

function extractErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") {
        return "";
    }
    const direct = (error as { code?: unknown }).code;
    if (typeof direct === "string" || typeof direct === "number") {
        return String(direct);
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object") {
        const nested = (cause as { code?: unknown }).code;
        if (typeof nested === "string" || typeof nested === "number") {
            return String(nested);
        }
    }
    return "";
}
