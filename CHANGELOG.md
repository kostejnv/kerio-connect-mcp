# Changelog

All notable changes to this project are documented in this file. The project
follows [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-10-23

Fork focused on reliable mail reading. Breaking: all non-mail and mail-changing
tools were removed and the tools were renamed.

### Added

- Remote MCP endpoint (Streamable HTTP) with a stateless OAuth 2.1 server:
  users sign in with their own Kerio server, login and password; credentials
  live only inside encrypted tokens (AES-256-GCM), nothing is stored on the
  server. Access tokens last 1 hour, refresh tokens 90 days.
- `mail_search`: all folders or one folder, server-side full-text query,
  sender/recipient/subject/date/unread filters with complete scanning,
  exact totals and `nextOffset` pagination.
- `mail_get`: direct `Mails.getById` lookup (any message age) and the full
  body in parts with explicit COMPLETE/PARTIAL status.
- Optional `mail_send` (plain text, To/Cc/Bcc) with clear SENT / SENT WITH
  WARNINGS / NOT SENT / RESULT UNKNOWN outcomes and no automatic retry.
- API method allowlist in the client; session renewal with one retry for reads.
- Outbound policy: https only, optional host allowlist, private networks blocked.
- Dockerfile and docker-compose for deployment behind a reverse proxy.
- Tests against an HTTPS mock of the Kerio API; optional read-only integration test.

### Changed

- TLS certificates are always verified; `KERIO_CA_FILE` adds a company CA.
- Sending requires an explicit `true` (stdio: `KERIO_ENABLE_SEND`; http:
  `KERIO_ALLOW_SEND` plus a per-connection opt-in). Invalid values stop startup.

### Removed

- Notes, tasks, contacts, calendar, folder creation, drafts, move, flag,
  mark-read and delete tools.

## [0.2.1] - 2026-09-02

### Added

- Opt-in live compatibility test for OpenAI-compatible tool-calling models.
- Regression coverage for Qwen-style serialized number, boolean, and array
  arguments.

### Changed

- Made MCP tool execution tolerant of unambiguously double-serialized JSON
  values while retaining strict Zod validation for invalid values.
- Optimized shared-calendar tool descriptions so owner-qualified selectors such
  as `Timon/Team` are preserved by Qwen 3.8 27B.
- Updated the documented primary test model from gpt-oss:20b to Qwen 3.8 27B.

## [0.2.0] - 2026-09-01

### Added

- Discovery of personal, shared, remote, and public Kerio calendars.
- Unambiguous calendar selection by owner/name, owner email/name, or folder ID.
- Regression tests for calendar discovery, deduplication, API fallbacks, and
  duplicate calendar names.
- Continuous integration for Node.js 18, 20, and 22.

### Changed

- Updated runtime and development dependencies within compatible version ranges.
- Synchronized the MCP server and Kerio client version with the npm package
  version at runtime.
- Added explicit diagnostics when optional shared or public folder APIs are
  unavailable while preserving personal-calendar fallback behavior.

### Security

- Updated the dependency lockfile to resolve all reported npm audit findings.

## [0.1.0] - 2026-01-08

- Initial public release of the Kerio Connect MCP server.

[0.2.1]: https://github.com/aimbitgmbh/kerio-connect-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aimbitgmbh/kerio-connect-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aimbitgmbh/kerio-connect-mcp/releases/tag/v0.1.0
