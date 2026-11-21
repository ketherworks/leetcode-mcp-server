import { LeetCodeSite } from "../cli.js";
import {
    OjCapabilities,
    OjFetchInput,
    OjProblemDocument,
    OjProviderHealth,
    OjSearchInput,
    OjSearchResult
} from "./contracts.js";
import { LeetCodeAdapterError, LeetCodeAdapterErrorCode } from "./errors.js";
import { LeetCodePolicyGuard } from "./policy-guard.js";
import { OjContractSerializer, ProviderObservation } from "./serializer.js";
import { AnonymousLeetCodeService } from "./service.js";
import {
    classifyTransportError,
    createServiceQueryTransport,
    LeetCodeQueryTransport
} from "./transport.js";

export { LeetCodeAdapterError, type LeetCodeAdapterErrorCode };

export interface LeetCodeOjReadProvider {
    getCapabilities(): Promise<OjCapabilities>;
    getHealth(): Promise<OjProviderHealth>;
    search(input: OjSearchInput): Promise<OjSearchResult>;
    fetchProblem(input: OjFetchInput): Promise<OjProblemDocument>;
}

interface SharedProviderOptions {
    policyGuard?: LeetCodePolicyGuard;
    serializer?: OjContractSerializer;
    nowIso?: () => string;
}

export type LeetCodeOjProviderOptions =
    | (SharedProviderOptions & {
          service: AnonymousLeetCodeService;
          site: LeetCodeSite;
          transport?: undefined;
      })
    | (SharedProviderOptions & {
          transport: LeetCodeQueryTransport;
          site?: LeetCodeSite;
          service?: undefined;
      });

export class LeetCodeOjProvider implements LeetCodeOjReadProvider {
    private readonly transport: LeetCodeQueryTransport;
    private readonly site: LeetCodeSite;
    private readonly policyGuard: LeetCodePolicyGuard;
    private readonly serializer: OjContractSerializer;
    private readonly nowIso: () => string;
    private observation?: ProviderObservation;

    constructor(options: LeetCodeOjProviderOptions) {
        this.policyGuard = options.policyGuard ?? new LeetCodePolicyGuard();
        this.serializer = options.serializer ?? new OjContractSerializer();
        this.nowIso = options.nowIso ?? (() => new Date().toISOString());

        if ("transport" in options && options.transport) {
            if (options.site && options.site !== options.transport.site) {
                throw new Error(
                    "Configured LeetCode site does not match transport site."
                );
            }
            this.transport = options.transport;
            this.site = options.transport.site;
        } else {
            this.transport = createServiceQueryTransport({
                service: options.service,
                site: options.site
            });
            this.site = options.site;
        }

        this.policyGuard.assertAnonymousTransport(this.transport);
    }

    async getCapabilities(): Promise<OjCapabilities> {
        return this.serializer.serializeCapabilities(this.site, this.nowIso());
    }

    async getHealth(): Promise<OjProviderHealth> {
        return this.serializer.serializeHealth(this.nowIso(), this.observation);
    }

    async search(input: OjSearchInput): Promise<OjSearchResult> {
        const request = this.policyGuard.validateSearchRequest(
            input,
            this.site
        );
        try {
            this.policyGuard.assertAnonymousTransport(this.transport);
            const raw = await this.transport.searchProblems({
                query: request.query,
                limit: request.limit,
                offset: request.offset
            });
            const auditedPage = this.policyGuard.guardSearchPage(
                raw,
                this.site
            );
            const fetchedAt = this.nowIso();
            const result = this.serializer.serializeSearchResult({
                site: this.site,
                requestId: request.requestId,
                query: request.query,
                offset: request.offset,
                page: auditedPage,
                fetchedAt
            });
            this.observation = { state: "success", checkedAt: fetchedAt };
            return result;
        } catch (error) {
            throw this.recordAndMapError(error);
        }
    }

    async fetchProblem(input: OjFetchInput): Promise<OjProblemDocument> {
        const ref = this.policyGuard.validateFetchRequest(input, this.site);
        try {
            this.policyGuard.assertAnonymousTransport(this.transport);
            const raw = await this.transport.fetchProblem(ref.nativeId);
            const auditedProblem = this.policyGuard.guardFetchedProblem(
                raw,
                ref.nativeId,
                this.site
            );
            const fetchedAt = this.nowIso();
            const result = this.serializer.serializeProblemDocument({
                site: this.site,
                problem: auditedProblem,
                fetchedAt
            });
            this.observation = { state: "success", checkedAt: fetchedAt };
            return result;
        } catch (error) {
            throw this.recordAndMapError(error);
        }
    }

    private recordAndMapError(error: unknown): LeetCodeAdapterError {
        const mapped = classifyTransportError(error);
        this.observation = {
            state: "error",
            checkedAt: this.nowIso(),
            code: mapped.code
        };
        return mapped;
    }
}
