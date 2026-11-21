import { OjError, ojErrorSchema } from "./contracts.js";

export const PROVIDER_ID = "leetcode-query-anonymous-adapter";
export const PROVIDER_VERSION = "0.1.0";
export const PROTOCOL_VERSION = "2025-11-25";

export type LeetCodeAdapterErrorCode =
    | "request.invalid"
    | "policy.blocked"
    | "resource.not_found"
    | "network.timeout"
    | "rate_limited"
    | "upstream.unavailable"
    | "upstream.schema_changed";

export class LeetCodeAdapterError extends Error {
    constructor(
        public readonly code: LeetCodeAdapterErrorCode,
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = "LeetCodeAdapterError";
    }
}

export function toOjError(
    code: LeetCodeAdapterErrorCode | "internal",
    message: string,
    requestId?: string
): OjError {
    const retryable =
        code === "network.timeout" ||
        code === "rate_limited" ||
        code === "upstream.unavailable";
    return ojErrorSchema.parse({
        schemaVersion: "oj.error/v1",
        code,
        layer:
            code === "request.invalid" || code === "internal"
                ? "broker"
                : code === "policy.blocked"
                  ? "policy"
                  : code === "network.timeout"
                    ? "transport"
                    : "upstream",
        message,
        retryPolicy: retryable ? "safe_read" : "never",
        userAction: retryable
            ? "retry"
            : code === "upstream.schema_changed" || code === "internal"
              ? "open_logs"
              : "none",
        platform: "leetcode",
        providerId: PROVIDER_ID,
        requestId
    });
}
