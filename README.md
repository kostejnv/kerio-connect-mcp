# Kerio Connect MCP (mail and contacts)

An [MCP](https://modelcontextprotocol.io) server that connects AI assistants (Claude, ChatGPT, Claude Code, …) to a
**Kerio Connect** mailbox.

- **Reading:** list folders, search the whole history, read complete messages, read attachments and get download links
  for them. Reading never marks messages as read or changes them.
- **Explicit updates:** mark selected messages read or unread; find, create and partially update contacts, including birthdays.
- **Drafts, never sending:** the assistant prepares e-mails and replies as drafts in the Drafts folder; the user reviews
  and sends them from Kerio Webmail. The server has no way to send e-mail.
- **Remote or local:** a hosted endpoint with OAuth sign-in (users enter their own Kerio server, username and password;
  nothing is stored on the server), or a local stdio process for one mailbox.
- **Direct Kerio API:** talks to the Kerio client JSON-RPC API (`/webmail/api/jsonrpc`). No IMAP, no Outlook, no forwarding.

Fork of [aimbitgmbh/kerio-connect-mcp](https://github.com/aimbitgmbh/kerio-connect-mcp) (MIT), focused on mail and contacts, and
reworked for reliable reading and remote use.

## Tools

| Tool | Purpose |
|---|---|
| `mail_folders_list` | List mail folders with IDs, paths and roles (inbox, sent, drafts, deleted, junk) |
| `mail_search` | Search all folders or one folder: full-text `query`, `direction`, `from`, `to`, `subject`, `dateFrom`, `dateTo`, `unreadOnly`; every result is marked INCOMING / OUTGOING / DRAFT; exact totals and `nextOffset` paging; always states whether the search is complete |
| `mail_get` | Read one message by ID (any age), full text in parts with `COMPLETE` / `PARTIAL` status, numbered attachments |
| `mail_get_attachment` | Read an attachment: text from PDF, DOCX, XLSX/XLS/ODS, CSV, text, HTML, ICS, EML; images as images |
| `mail_attachment_link` | Download links for attachments in their original format, one per file plus one ZIP (remote mode, 10 minutes) |
| `mail_create_draft` | Save a new e-mail or a reply (`replyToId`, `replyAll`: recipients, `RE:` subject, quoted original, In-Reply-To) as a draft; text in a small Markdown subset; attachments only from e-mails already in the mailbox, new files as links in the text |
| `mail_update_draft` | Change recipients, subject, text or attachments of a draft; only messages in the Drafts folder |
| `mail_set_read_status` | Set selected message IDs to read or unread, with verified per-message outcomes |
| `contacts_search` | Search by name, e-mail or phone; browse contacts and discover contact folders |
| `contacts_get` | Read a complete contact by ID |
| `contacts_create` | Create an ordinary contact in a selected contact folder |
| `contacts_update` | Partially update a contact; omitted fields stay unchanged |

Details and response formats: [docs/tools.md](docs/tools.md). Opening the server address in a browser shows a landing
page with the same information for people.

## Connecting a client

Hosted instance: `https://kerio.kostejnv.cz/mcp`.

| Client | How |
|---|---|
| Claude (web, desktop) | Settings → Connectors → Add custom connector → paste the URL |
| ChatGPT | Settings → Apps & Connectors → Developer mode → Create → MCP server URL, authentication OAuth |
| Claude Code | `claude mcp add --transport http --scope user kerio https://kerio.kostejnv.cz/mcp`, then `/mcp` → `kerio` → Authenticate |

A sign-in page opens (English, Czech switch at the top). Enter your Kerio server (e.g. `mail.example.com`), username and
password. Use a regular account, not an administrator.

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
        "KERIO_PASSWORD": "…"
      }
    }
  }
}
```

Build first with `npm install && npm run build`.

## Documentation

| Document | Contents |
|---|---|
| [Tools](docs/tools.md) | Arguments, response formats, completeness and continuation |
| [Security](docs/security.md) | Read-only reading, restricted writes, tokens and credentials, network policy |
| [Architecture](docs/architecture.md) | Components, sign-in and request flows, stateless design, Kerio API usage |
| [Deployment](docs/deployment.md) | Docker and reverse proxy setup, configuration, operations, troubleshooting |
| [Development](docs/development.md) | Local setup, tests and the Kerio API mock, extending the server |
| [Verification](docs/verification.md) | What is verified, open assumptions about Kerio, checklist for a real server |
| [Changelog](CHANGELOG.md) | Version history |

## Status

Mail reading and drafts have been checked against a real Kerio server; see [docs/verification.md](docs/verification.md).
Contacts and explicit read/unread updates are covered by simulated API tests and still need a controlled real-server pilot.
For the suggested agent workflow, see [docs/triage-workflow.md](docs/triage-workflow.md).

## License

MIT — see [LICENSE](LICENSE).
