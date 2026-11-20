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
import { LeetCodeAdapterError, PROVIDER_VERSION, toOjError } from "./errors.js";
import { LeetCodeOjReadProvider } from "./provider.js";

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
    provider: LeetCodeOjReadProvider;
}): Server {
    const server = new Server(
        { name: "leetcode-mcp-private", version: PROVIDER_VERSION },
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
                    toOjError(
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
            toOjError(
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
        return toToolError(toOjError(error.code, error.message, requestId));
    }
    return toToolError(
        toOjError(
            "internal",
            "The private LeetCode adapter failed without exposing internal data.",
            requestId
        )
    );
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
