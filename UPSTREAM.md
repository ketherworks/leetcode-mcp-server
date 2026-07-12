# Upstream Provenance

This repository preserves the Git history and MIT `LICENSE` of its upstream base.

- Project: `jinzcdev/leetcode-mcp-server`
- Repository: https://github.com/jinzcdev/leetcode-mcp-server
- Upstream release: `v1.3.0`
- Upstream commit: `caca0cb38a95dc2c5a8e411196f95c0a01f1f82c`
- Private adapter version: `0.1.0`
- Adaptation date: `2026-07-12`

The private adaptation changes the package identity and executable registration
surface. Existing service implementations are retained and instantiated through
the upstream `LeetCodeServiceFactory` with an explicitly undefined session. The
entry point exposes only an anonymous, read-only, local-stdio OJ contract adapter.

No upstream history was squashed or replaced. The original MIT license remains in
`LICENSE`.
