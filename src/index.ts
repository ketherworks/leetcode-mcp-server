#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAnonymousService } from "./anonymous-service.js";
import { CliUsageError, cliHelp, parseCliOptions } from "./cli.js";
import { LeetCodeOjProvider } from "./oj/provider.js";
import { createLeetCodeMcpServer } from "./oj/server.js";

async function main(): Promise<void> {
    const options = parseCliOptions(process.argv.slice(2), process.env);
    if (options.help) {
        process.stdout.write(`${cliHelp()}\n`);
        return;
    }

    const service = await createAnonymousService(options.site);
    const provider = new LeetCodeOjProvider({ service, site: options.site });
    const server = createLeetCodeMcpServer({ provider });
    await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
    const message =
        error instanceof CliUsageError
            ? error.message
            : "Failed to start the anonymous LeetCode MCP adapter.";
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
