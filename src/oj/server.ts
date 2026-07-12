import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    CallToolResult,
    ListToolsRequestSchema,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
    leetCodeFetchInputSchema,
    leetCodeSearchInputSchema,
    ojCapabilitiesSchema,
    OjError,
    ojErrorSchema,
    ojProblemDocumentSchema,
    ojProviderHealthSchema,
    ojSearchResultSchema
} from "./contracts.js";
import { LeetCodeAdapterError, LeetCodeOjProvider } from "./provider.js";

export const LEETCODE_MCP_TOOL_NAMES = [
    "oj_capabilities",
    "oj_health",
    "oj_search_problems",
    "oj_fetch_problem"
] as const;

const emptyInputSchema = z.object({}).strict();
const callToolRequestSchema = z
    .object({
        method: z.literal("tools/call"),
        params: z
            .object({
                name: z.string().min(1),
                arguments: z.record(z.unknown()).optional()
            })
            .passthrough()
    })
    .passthrough();
type ReadOnlyCallToolRequest = z.infer<typeof callToolRequestSchema>;
type RegisterCallToolHandler = (
    schema: typeof callToolRequestSchema,
    handler: (request: ReadOnlyCallToolRequest) => Promise<CallToolResult>
) => void;

export function createLeetCodeMcpServer(options: {
    provider: LeetCodeOjProvider;
}): Server {
    const server = new Server(
        { name: "leetcode-mcp-private", version: "0.1.0" },
        { capabilities: { tools: { listChanged: false } } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: getLeetCodeMcpToolDefinitions()
    }));
    const registerCallToolHandler = server.setRequestHandler.bind(
        server
    ) as unknown as RegisterCallToolHandler;
    registerCallToolHandler(callToolRequestSchema, async (request) => {
        const input = request.params.arguments ?? {};
        switch (request.params.name) {
            case "oj_capabilities":
                return callSafely(emptyInputSchema, input, () =>
                    options.provider.getCapabilities()
                );
            case "oj_health":
                return callSafely(emptyInputSchema, input, () =>
                    options.provider.getHealth()
                );
            case "oj_search_problems":
                return callSafely(leetCodeSearchInputSchema, input, (parsed) =>
                    options.provider.search(parsed)
                );
            case "oj_fetch_problem":
                return callSafely(leetCodeFetchInputSchema, input, (parsed) =>
                    options.provider.fetchProblem(parsed)
                );
            default:
                return toToolError(
                    ojError(
                        "request.invalid",
                        "Unknown tool. This adapter exposes exactly four anonymous read tools."
                    )
                );
        }
    });

    return server;
}

export function getLeetCodeMcpToolDefinitions(): Tool[] {
    return [
        tool(
            "oj_capabilities",
            "Report the audited anonymous LeetCode read surface and excluded operations.",
            emptyInputSchema,
            ojCapabilitiesSchema,
            false
        ),
        tool(
            "oj_health",
            "Report local readiness and the most recent anonymous LeetCode read observation.",
            emptyInputSchema,
            ojProviderHealthSchema,
            false
        ),
        tool(
            "oj_search_problems",
            "Search public LeetCode problem metadata with bounded cursor pagination.",
            leetCodeSearchInputSchema,
            ojSearchResultSchema,
            true
        ),
        tool(
            "oj_fetch_problem",
            "Fetch one public non-premium LeetCode statement as a bounded OJ problem document.",
            leetCodeFetchInputSchema,
            ojProblemDocumentSchema,
            true
        )
    ];
}

function tool(
    name: (typeof LEETCODE_MCP_TOOL_NAMES)[number],
    description: string,
    inputSchema: z.ZodType,
    successSchema: z.ZodType,
    openWorldHint: boolean
): Tool {
    return {
        name,
        description,
        inputSchema: jsonSchema(inputSchema) as Tool["inputSchema"],
        outputSchema: {
            type: "object",
            anyOf: [jsonSchema(successSchema), jsonSchema(ojErrorSchema)]
        } as Tool["outputSchema"],
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint
        }
    };
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
    const { $schema: _dialect, ...result } = zodToJsonSchema(schema, {
        $refStrategy: "none"
    }) as Record<string, unknown>;
    return result;
}

async function callSafely<T>(
    schema: z.ZodType<T>,
    input: unknown,
    operation: (parsed: T) => Promise<object>
): Promise<CallToolResult> {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        return toToolError(
            ojError(
                "request.invalid",
                "Tool input did not match its strict bounded schema.",
                requestIdFrom(input)
            )
        );
    }
    try {
        return toToolResult(await operation(parsed.data));
    } catch (error) {
        return mapError(error, requestIdFrom(input));
    }
}

function mapError(error: unknown, requestId?: string): CallToolResult {
    if (error instanceof LeetCodeAdapterError) {
        return toToolError(ojError(error.code, error.message, requestId));
    }
    return toToolError({
        schemaVersion: "oj.error/v1",
        code: "internal",
        layer: "broker",
        message:
            "The private LeetCode adapter failed without exposing internal data.",
        retryPolicy: "never",
        userAction: "open_logs",
        platform: "leetcode",
        providerId: "leetcode-query-anonymous-adapter",
        requestId
    });
}

function ojError(
    code: LeetCodeAdapterError["code"] | "internal",
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
            code === "request.invalid"
                ? "broker"
                : code === "policy.blocked"
                  ? "policy"
                  : code === "network.timeout"
                    ? "transport"
                    : code === "internal"
                      ? "broker"
                      : "upstream",
        message,
        retryPolicy: retryable ? "safe_read" : "never",
        userAction: retryable
            ? "retry"
            : code === "upstream.schema_changed" || code === "internal"
              ? "open_logs"
              : "none",
        platform: "leetcode",
        providerId: "leetcode-query-anonymous-adapter",
        requestId
    });
}

function toToolResult(result: object): CallToolResult {
    const structuredContent = result as Record<string, unknown>;
    return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent
    };
}

function toToolError(error: OjError): CallToolResult {
    return {
        isError: true,
        content: [{ type: "text", text: error.message }],
        structuredContent: error as unknown as Record<string, unknown>
    };
}

function requestIdFrom(input: unknown): string | undefined {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return undefined;
    }
    const requestId = (input as { requestId?: unknown }).requestId;
    return typeof requestId === "string" &&
        requestId.length >= 1 &&
        requestId.length <= 128
        ? requestId
        : undefined;
}
