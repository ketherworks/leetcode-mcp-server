# @ketherworks/leetcode-mcp-private

Private, local-only MCP adapter for anonymous public LeetCode problem reads. It is a
thin policy layer over the upstream `LeetCodeServiceFactory`; it is not an official
LeetCode integration.

## Boundary

- Transport: local `stdio` only.
- Sites: `--site global` or `--site cn`; default is `global`.
- Authentication: forbidden. `--session` and any existing `LEETCODE_SESSION`
  environment variable are rejected without printing credential values.
- Tools: exactly `oj_capabilities`, `oj_health`, `oj_search_problems`, and
  `oj_fetch_problem`.
- Resources and all user, contest, solution, editorial, note, run, and submit
  surfaces are not registered.
- Compliance: `unofficial`; the adapter uses anonymous LeetCode endpoints through
  the upstream `leetcode-query` service implementation.

Only allowlisted OJ contract fields are returned. Hints, similar questions,
editorials, solution objects, unknown upstream fields, and Premium problem content
are excluded. A Premium problem fetch returns a structured `oj.error/v1`
`policy.blocked` result.

## Local Use

```bash
npm ci
npm run build
node build/index.js --site global
```

MCP client configuration:

```json
{
  "mcp": {
    "servers": {
      "leetcode-private": {
        "type": "stdio",
        "command": "node",
        "args": ["/absolute/path/to/build/index.js", "--site", "global"]
      }
    }
  }
}
```

Do not configure credentials. This package provides no HTTP server, Worker, cache,
code execution, or submission workflow.

## Provenance And License

The adapter is based on upstream `v1.3.0` at commit
`caca0cb38a95dc2c5a8e411196f95c0a01f1f82c`. See [UPSTREAM.md](UPSTREAM.md),
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES), and [LICENSE](LICENSE).

Default tests are deterministic. The retained upstream live service tests run only
when `LEETCODE_LIVE_TESTS=1` is set explicitly.
