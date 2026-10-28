# Development

## Setup

Requires Node.js 22 or newer (the PDF library needs it). Without a local Node 22, run the tests in the same image as
production:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-alpine sh -c "npm ci && npm test"
```

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
| `tests/drafts.test.mjs` | Drafts: new, reply, reply all, attachments, updates keeping quote and attachments, only drafts editable, no retries, client refuses anything but one draft |
| `tests/markdown.test.mjs` | The Markdown subset for draft text, escaping, allowed link schemes, misleading link texts |
| `tests/oauth-http.test.mjs` | Whole OAuth flow with PKCE, sign-in form, token refresh, no send tool, remote `/mcp` |
| `tests/config.test.mjs` | Strict switches, token key validation, sealed token integrity |
| `tests/tool-arguments.test.mjs` | Conversion of stringified tool arguments |
| `tests/attachments.test.mjs` | Attachment text from PDF, DOCX, XLSX, text; images; size and URL limits |
| `tests/download-links.test.mjs` | Download links and ZIP: original bytes, headers, inline images, tampered tickets |

Attachment fixtures (`tests/fixtures/sample.*`) are tiny generated files: a two-page PDF, a DOCX, a two-sheet XLSX and a
1×1 PNG.
| `tests/integration/readonly.test.mjs` | Optional, read-only, real server; skipped unless `KERIO_INTEGRATION=1` |

No test sends e-mail; the connector cannot. The integration test only reads and saves no drafts.

## Changing the code

**Adding a read tool:** add a Zod schema and a definition with read-only annotations in `src/mail-tools.ts`, a case in
`callTool` in `src/mcp-server.ts`, and tests against the mock. If it needs a new Kerio method, it must be a method that
does not change data; add it to `READ_METHODS` in `src/client.ts` and to the mock.

**Never** add a method that changes mailbox data to `READ_METHODS`. The only write path is the draft path in
`src/client.ts` (`DRAFT_METHODS`, `assertDraftOnly`), which accepts nothing but one draft with `send: false`. Do not add
a way to send.

**Tool descriptions** are read by the agent; keep them precise about completeness, continuation and untrusted content.

Code comments and documentation are in English.

## Release

1. Update `CHANGELOG.md` and the version in `package.json`.
2. `npm test` and `npm audit --omit=dev`.
3. Push to `main`, then update the deployment (see [Deployment](deployment.md#operations)).
