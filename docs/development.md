# Development

## Setup

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm test
```

| Script | What it does |
|---|---|
| `npm run dev` | Run from source with `tsx` (reads `.env`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm test` | Build, then run all tests against the simulated Kerio API |
| `npm run test:integration` | Build, then run the optional read-only test against a real Kerio server |

## Running locally

**stdio, one mailbox** — `.env`:

```bash
MCP_TRANSPORT=stdio
KERIO_SERVER=mail.example.com
KERIO_USERNAME=user@example.com
KERIO_PASSWORD=...
```

Then point an MCP client at `node dist/index.js`, or inspect it with
`npx @modelcontextprotocol/inspector node dist/index.js`.

**http, OAuth** — `.env`:

```bash
MCP_TRANSPORT=http
PUBLIC_URL=http://localhost:3000
MCP_TOKEN_KEY=...   # openssl rand -base64 32
```

`npm run dev`, then `claude mcp add --transport http kerio-local http://localhost:3000/mcp`. Plain `http` is accepted for
`localhost` only.

## Tests

The tests run against `tests/helpers/mock-kerio.mjs`, an in-process **HTTPS** mock of the Kerio JSON-RPC API. It uses a
test CA and certificate for `localhost` (`tests/fixtures/`; the CA's private key was discarded), which also exercises
certificate verification and the custom-CA path. The mock records every call, so tests assert which API methods were
used and that nothing changed.

| File | Covers |
|---|---|
| `tests/client.test.mjs` | `Mails.getById` for old messages, session renewal, login errors, method allowlist, TLS, network policy |
| `tests/mail-tools.test.mjs` | Folder paths, exact paging, complete filtered scans, date ranges, full long bodies, read-only behaviour |
| `tests/send.test.mjs` | Disabled sending (tool list, direct call, client layer, no side effects), enabled sending and all outcomes |
| `tests/oauth-http.test.mjs` | Whole OAuth flow with PKCE, sign-in form, token refresh, send opt-in and master switch, remote `/mcp` |
| `tests/config.test.mjs` | Strict switches, token key validation, sealed token integrity |
| `tests/tool-arguments.test.mjs` | Conversion of stringified tool arguments |
| `tests/integration/readonly.test.mjs` | Optional, read-only, real server; skipped unless `KERIO_INTEGRATION=1` |

No test sends real e-mail. The integration test creates its client with sending disabled.

## Changing the code

**Adding a read tool:** add a Zod schema and a definition with read-only annotations in `src/mail-tools.ts`, a case in
`callTool` in `src/mcp-server.ts`, and tests against the mock. If it needs a new Kerio method, it must be a method that
does not change data; add it to `READ_METHODS` in `src/client.ts` and to the mock.

**Never** add a method that changes mailbox data to `READ_METHODS`. Write operations need their own guarded path like
`sendMail`, a server-level switch and tests proving the disabled state makes no request.

**Tool descriptions** are read by the agent; keep them precise about completeness, continuation and untrusted content.

Code comments and documentation are in English.

## Release

1. Update `CHANGELOG.md` and the version in `package.json`.
2. `npm test` and `npm audit --omit=dev`.
3. Push to `main`, then update the deployment (see [Deployment](deployment.md#operations)).
