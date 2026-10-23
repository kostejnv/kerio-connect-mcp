# Kerio Connect MCP (mail)

An [MCP](https://modelcontextprotocol.io) server that connects AI assistants (Claude, ChatGPT, Claude Code, …) to a
**Kerio Connect** mailbox.

- **Read-only by default:** list folders, search the whole history, read complete messages. Reading never marks
  messages as read or changes them.
- **Sending is opt-in:** off unless the server operator enables it and the user opts in per connection.
- **Remote or local:** a hosted endpoint with OAuth sign-in (users enter their own Kerio server, username and password;
  nothing is stored on the server), or a local stdio process for one mailbox.
- **Direct Kerio API:** talks to the Kerio client JSON-RPC API (`/webmail/api/jsonrpc`). No IMAP, no Outlook, no forwarding.

Fork of [aimbitgmbh/kerio-connect-mcp](https://github.com/aimbitgmbh/kerio-connect-mcp) (MIT), narrowed to mail and
reworked for reliable reading and remote use.

## Tools

| Tool | Purpose |
|---|---|
| `mail_folders_list` | List mail folders with IDs and paths |
| `mail_search` | Search all folders or one folder: full-text `query`, `from`, `to`, `subject`, `dateFrom`, `dateTo`, `unreadOnly`; exact totals and `nextOffset` paging; always states whether the search is complete |
| `mail_get` | Read one message by ID (any age), full text in parts with `COMPLETE` / `PARTIAL` status |
| `mail_send` | Send a plain-text message (To, Cc, Bcc) — only on connections with sending enabled |

Details and response formats: [docs/tools.md](docs/tools.md).

## Connecting a client

Hosted instance: `https://kerio.kostejnv.cz/mcp`.

| Client | How |
|---|---|
| Claude (web, desktop) | Settings → Connectors → Add custom connector → paste the URL |
| ChatGPT | Settings → Apps & Connectors → Developer mode → Create → MCP server URL, authentication OAuth |
| Claude Code | `claude mcp add --transport http --scope user kerio https://kerio.kostejnv.cz/mcp`, then `/mcp` → `kerio` → Authenticate |

A sign-in page opens (English, Czech switch at the top). Enter your Kerio server (e.g. `mail.example.com`), username and
password. Use a regular account, not an administrator.

### Read-only (default)

Leave **Allow sending e-mails** unchecked (or the option is not shown at all when the server does not allow sending).
The assistant can only read.

### Enabling sending

1. The operator sets `KERIO_ALLOW_SEND=true` on the server ([deployment](docs/deployment.md#operations)).
2. You connect with **Allow sending e-mails** checked. Other connections stay read-only.

The assistant cannot change this itself. Sending is never retried automatically; unclear results are reported as
`RESULT UNKNOWN` so nothing is sent twice.

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

Build first with `npm install && npm run build`. `KERIO_ENABLE_SEND=true` enables sending in stdio mode; any value other
than exactly `true` or `false` stops the server from starting.

## Documentation

| Document | Contents |
|---|---|
| [Tools](docs/tools.md) | Arguments, response formats, completeness and continuation |
| [Security](docs/security.md) | Read-only enforcement, sending safeguards, tokens and credentials, network policy |
| [Architecture](docs/architecture.md) | Components, sign-in and request flows, stateless design, Kerio API usage |
| [Deployment](docs/deployment.md) | Docker and reverse proxy setup, configuration, operations, troubleshooting |
| [Development](docs/development.md) | Local setup, tests and the Kerio API mock, extending the server |
| [Verification](docs/verification.md) | What is verified, open assumptions about Kerio, checklist for a real server |
| [Changelog](CHANGELOG.md) | Version history |

## Status

All behaviour is covered by tests against a simulated Kerio API. It has **not yet been verified against a real Kerio
Connect server**; see [docs/verification.md](docs/verification.md) for the open assumptions and how to check them.

## License

MIT — see [LICENSE](LICENSE).
