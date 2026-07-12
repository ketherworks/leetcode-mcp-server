export type LeetCodeSite = "global" | "cn";

export interface CliOptions {
    site: LeetCodeSite;
    help: boolean;
}

export class CliUsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CliUsageError";
    }
}

export function parseCliOptions(
    argv: string[],
    env: Record<string, string | undefined> = process.env
): CliOptions {
    if (Object.prototype.hasOwnProperty.call(env, "LEETCODE_SESSION")) {
        throw new CliUsageError(
            "LEETCODE_SESSION is forbidden for this anonymous adapter."
        );
    }

    let site: LeetCodeSite = "global";
    let siteSeen = false;
    let help = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--help") {
            help = true;
            continue;
        }
        if (argument === "--session" || argument.startsWith("--session=")) {
            throw new CliUsageError(
                "Session credentials are forbidden for this anonymous adapter."
            );
        }
        if (argument === "--site") {
            if (siteSeen || index + 1 >= argv.length) {
                throw new CliUsageError(
                    "--site must be provided once with global or cn."
                );
            }
            site = parseSite(argv[index + 1]);
            siteSeen = true;
            index += 1;
            continue;
        }
        if (argument.startsWith("--site=")) {
            if (siteSeen) {
                throw new CliUsageError("--site may only be provided once.");
            }
            site = parseSite(argument.slice("--site=".length));
            siteSeen = true;
            continue;
        }
        if (argument.startsWith("-")) {
            throw new CliUsageError("Unsupported command-line option.");
        }
        throw new CliUsageError("Unexpected positional argument.");
    }

    return { site, help };
}

export function cliHelp(): string {
    return [
        "LeetCode MCP Private - anonymous local read-only adapter",
        "",
        "Usage: leetcode-mcp-private [--site global|cn] [--help]",
        "",
        "Authentication and session credentials are not supported."
    ].join("\n");
}

function parseSite(value: string): LeetCodeSite {
    if (value === "global" || value === "cn") {
        return value;
    }
    throw new CliUsageError("--site must be global or cn.");
}
