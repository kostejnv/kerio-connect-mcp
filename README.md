# Kerio Connect MCP (mail)

An MCP server that connects AI assistants (Claude, ChatGPT, Claude Code, …) to a **Kerio Connect** mailbox.
By default it is **read-only**: folders, search including old history, and full message text.
Sending is optional and must be explicitly enabled in the server configuration.

Fork of [aimbitgmbh/kerio-connect-mcp](https://github.com/aimbitgmbh/kerio-connect-mcp) (MIT), narrowed to mail
and reworked for reliable reading and remote use.

The server talks directly to the Kerio client API (`/webmail/api/jsonrpc`, `Session.login`, session cookie and `X-Token`).
No IMAP, no Outlook, no mail forwarding.

## Tools

| Tool | What it does | Annotations |
|---|---|---|
| `mail_folders_list` | Mail folders with IDs and paths | read-only |
| `mail_search` | Search all folders or one folder, newest first. Server-side full-text `query` plus `from`, `to`, `subject`, `dateFrom`, `dateTo`, `unreadOnly` filters. Paging via `limit` and `offset`/`nextOffset`. | read-only |
| `mail_get` | One message by ID via `Mails.getById` (works for messages of any age): headers, attachment names, full text. Long bodies come in parts marked `COMPLETE` / `PARTIAL` + `nextOffset`. | read-only |
| `mail_send` | Send plain text (To, Cc, Bcc). **Only when sending is enabled.** | destructive |

`mail_search` responses always state whether the search is complete:

- **Full-text only / no filters:** Kerio evaluates everything; the response has the exact number of matches
  (`Showing results 1-20 of 1234`) and `nextOffset`.
- **With sender/recipient/subject/date/unread filters:** the API documentation does not list which fields can be filtered
  server-side, so the server scans the scope page by page itself (up to 5,000 messages per call; with `dateFrom` it stops
  early because results are newest first). If a call does not reach the end, the response says `Search NOT finished`
  and returns `nextOffset`. An empty result therefore never just means "nothing in the first few messages".

Reading never calls an API method that changes messages: seen state, flags and folders stay untouched.

## Security model

- **API method allowlist** in the client: in read-only mode only `Session.login`, `Folders.get`, `Mails.get`,
  `Mails.getById`. With sending enabled additionally `Mails.create`, and only for one new message with `send: true`
  (no drafts or templates). Anything else is refused before a request is made.
- **Disabled sending** is enforced three times: `mail_send` is missing from the tool list, a direct call is refused,
  and the client itself blocks `Mails.create`. The agent cannot change the switch through MCP.
- **Sending is never retried automatically.** The result is `SENT`, `SENT WITH WARNINGS` (sent, but e.g. the copy in
  Sent Items is missing), `NOT SENT`, or `RESULT UNKNOWN` (timeout, dropped connection). The agent is told not to resend
  and to let the user check the Sent folder.
- **Read requests** are repeated once after the session is renewed.
- **TLS** certificates are always verified. Add a company CA with `KERIO_CA_FILE`; verification cannot be disabled.
- **Outbound connections** use `https` only. Private and local network addresses are blocked (checked again after DNS
  resolution); optionally restrict hosts with `KERIO_ALLOWED_SERVERS`.
- **E-mail content** is marked for the agent as untrusted data (`<<<BEGIN UNTRUSTED EMAIL CONTENT>>>`), and the tool
  descriptions tell it not to follow instructions found in e-mails.
- **Logs** never contain passwords, tokens, cookies or message content.

> **Use a regular user account, not an administrator.** Read-only mode restricts this connector, not the credentials
> themselves: with the password, anything the account allows can be done through webmail or other clients.

### Sign-in in remote mode (OAuth, nothing stored on the server)

1. When the connector is added, Claude/ChatGPT opens this server's sign-in page (English, with a Czech switch).
2. The user enters the Kerio server address, username and password. The server tries to sign in to Kerio and only
   issues a token if that succeeds.
3. The credentials are encrypted (AES-256-GCM) with `MCP_TOKEN_KEY` into the tokens held by the MCP client. Nothing is
   stored on the server (no database, no files). Each request decrypts the token in memory only.
4. Access tokens last 1 hour, refresh tokens 90 days (renewed on every use). Changing `MCP_TOKEN_KEY` signs out all
   connections at once.

Residual risk: someone holding a token from the MCP client **and** the key from the server can recover the password.

## Connecting a client

### Claude / ChatGPT / Claude Code (remote server)

- **Claude:** Settings → Connectors → Add custom connector → URL `https://kerio.kostejnv.cz/mcp`.
- **ChatGPT:** Settings → Apps & Connectors → (Developer mode) → Create → MCP Server URL `https://kerio.kostejnv.cz/mcp`,
  Authentication: OAuth.
- **Claude Code:** `claude mcp add --transport http --scope user kerio https://kerio.kostejnv.cz/mcp`, then `/mcp` →
  `kerio` → Authenticate.

The sign-in page opens; enter the Kerio server (e.g. `mail.example.com`), username and password.

### Default: read-only

Without `KERIO_ALLOW_SEND=true` on the server, the sign-in page offers no sending option and no connection can send.

### Explicitly enabling sending

1. On the server set `KERIO_ALLOW_SEND=true` in `.env` and restart (`docker compose up -d`).
2. The sign-in page then shows an **Allow sending e-mails** checkbox, unchecked by default.
3. To send, add (or reconnect) the connector with the checkbox ticked. Other connections stay read-only.

Only the exact value `true` counts; anything else (`TRUE`, `1`, `yes`, …) stops the server from starting, so a typo
never enables sending.

### Local stdio (one mailbox)

```json
{
  "mcpServers": {
    "kerio": {
      "command": "node",
      "args": ["/path/to/kerio-connect-mcp/dist/index.js"],
      "env": {
        "KERIO_SERVER": "mail.example.com",
        "KERIO_USERNAME": "user@example.com",
        "KERIO_PASSWORD": "…",
        "KERIO_ENABLE_SEND": "false"
      }
    }
  }
}
```

In stdio mode sending is enabled with `KERIO_ENABLE_SEND=true`.

## Deployment (Docker behind a reverse proxy)

```bash
git clone https://github.com/kostejnv/kerio-connect-mcp.git /root/kerio-mcp
cd /root/kerio-mcp
cp .env.example .env && chmod 600 .env
# set PUBLIC_URL and MCP_TOKEN_KEY (openssl rand -base64 32)
docker compose up -d --build
```

The container publishes no ports and joins the `shared_net` network. Caddy only needs:

```
kerio.kostejnv.cz {
    reverse_proxy kerio-mcp:3000
}
```

Update: `git pull && docker compose up -d --build`.

## Configuration

| Variable | Mode | Default | Description |
|---|---|---|---|
| `MCP_TRANSPORT` | both | `stdio` | `stdio` or `http` (the Docker image sets `http`) |
| `PUBLIC_URL` | http | — | Public https URL of the server |
| `PORT` | http | `3000` | Port inside the container |
| `MCP_TOKEN_KEY` | http | — | 32 random bytes, base64; encrypts tokens |
| `KERIO_ALLOW_SEND` | http | `false` | Master switch; `true` = offer sending as a per-connection opt-in |
| `KERIO_ALLOWED_SERVERS` | http | empty | Allowed Kerio hosts, comma-separated (empty = any public host) |
| `KERIO_SERVER`, `KERIO_USERNAME`, `KERIO_PASSWORD` | stdio | — | Mailbox for local mode |
| `KERIO_ENABLE_SEND` | stdio | `false` | `true` = allow sending |
| `KERIO_CA_FILE` | both | — | PEM file with a company CA |
| `KERIO_REQUEST_TIMEOUT_MS` | both | `30000` | Timeout for requests to Kerio |
| `KERIO_ALLOW_PRIVATE_NETWORK` | both | `false` | Development only: allow a Kerio server on a private network |

## Tests

```bash
npm test                 # build + tests against a simulated Kerio API (HTTPS mock), no real mailbox needed
npm run test:integration # optional: read-only test against a real Kerio server (KERIO_SERVER/USERNAME/PASSWORD)
```

The regular tests cover: reading a message beyond the newest 500, complete long bodies in parts, completeness of filters
and paging, disabled sending (tool list, direct call, client layer, no side effects), enabled sending, partial success,
errors and timeouts without retries, certificate verification, custom CA, blocking private addresses, session renewal,
and the whole OAuth flow including PKCE, single-use codes and token refresh. No test sends real e-mail; the integration
test runs with sending disabled.

## What is verified and what is not

Everything above is verified **against the simulated API**, written from the official documentation. Nothing has been
verified against a real Kerio server yet. Assumptions to confirm on a real server:

1. `Mails.getById` returns `displayableParts` (message text) and does **not** change the seen state.
2. The `receiveDate` format (assumed `20240115T093000+0100` or ISO 8601), which date filters rely on.
3. `Mails.get` across several folders sorts by `receiveDate` descending and returns `totalItems`.
4. An expired session is reported with codes `-32001` to `-32003` or HTTP 401.
5. The error format of `Mails.create` on partial success (the text "partial" is looked for in the error code or message).
6. Kerio accepts an outgoing message with `from` = username (when the username is an e-mail address), otherwise without `from`.

### Verifying against a real server

1. `KERIO_INTEGRATION=1 KERIO_SERVER=… KERIO_USERNAME=… KERIO_PASSWORD=… npm run test:integration`
   (reads the oldest Inbox message, checks the seen state did not change, prints the date format).
2. In Claude/ChatGPT: list folders, find an old message by sender and date, read a long message completely.
3. In webmail, check that an unread message you read is still unread.
4. Only then enable sending and send one test message to your own address; check the Sent folder.
