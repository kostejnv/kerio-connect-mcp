# Security

## What the connector protects against

| Risk | Protection |
|---|---|
| Agent changes or deletes mail | Only read methods are allowed; no tool for moving, flagging, deleting or drafts exists |
| Agent sends mail when it should not | Sending is off by default and enforced in three layers (below) |
| Duplicate messages after an error | Sending is never retried; unclear outcomes are reported as `RESULT UNKNOWN` |
| Prompt injection through e-mails | Bodies and attachment text are marked as untrusted data; tool descriptions forbid acting on instructions in them |
| Hostile attachments | Parsed in an isolated worker (256 MB, 30 s), never executed; downloads only from the Kerio server's attachment path, 25 MB each |
| Download links leaking | Sealed, 10 minutes, one message's attachments only; served as downloads with `nosniff` and a sandbox CSP |
| Credentials stolen from the server | Nothing is stored; credentials exist only inside encrypted tokens held by the MCP client |
| Server abused as a proxy into private networks | https only, private/local addresses blocked (also after DNS resolution), optional host allowlist |
| Password guessing through the sign-in form | 10 sign-in attempts per IP per 15 minutes |
| Man-in-the-middle towards Kerio | TLS certificates are always verified |
| Secrets in logs | Logs contain no passwords, tokens, cookies or message content |

## Read-only by design

The Kerio client accepts only these methods in read-only mode: `Session.login`, `Folders.get`, `Mails.get`,
`Mails.getById`. Any other method is refused locally with an error before a request is made, even if code elsewhere
tried to call it. Attachment downloads are plain `GET` requests to the URL Kerio reports for an attachment; the client
accepts only URLs on the connected server under `/webmail/api/download/attachment/`.

## Download links

`mail_attachment_link` (remote mode) returns links of the form `/download/<ticket>/<file name>`. The ticket is sealed like
the OAuth tokens, with its own purpose, so it cannot be used as a token and a token cannot be used as a ticket. It holds
the credentials, the message ID and the attachment numbers, and expires after 10 minutes. Nothing is stored: opening the
link signs in to Kerio (or reuses the session), downloads the attachment(s) and passes them on, a single file unchanged
or several as a ZIP. Responses are always downloads (`Content-Disposition: attachment`), with `X-Content-Type-Options:
nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: no-store`, so an HTML attachment cannot run on the
server's origin. Anyone holding a link during its 10 minutes can download those attachments; treat links like the files.

## Sending

Sending needs two explicit decisions by people, never by the agent:

1. **Server operator:** `KERIO_ALLOW_SEND=true` (http) or `KERIO_ENABLE_SEND=true` (stdio). Only the exact value `true`
   counts; any other value stops the server from starting.
2. **User (http mode):** ticks *Allow sending e-mails* on the sign-in page. The choice is sealed into the tokens and can
   only be changed by connecting again.

The master switch is checked on every request, so turning it off withdraws sending from all connections immediately.

When sending is not enabled for a connection:

- `mail_send` is not in the tool list;
- a direct `mail_send` call is refused before anything is sent to Kerio;
- the client refuses `Mails.create` on its own.

When enabled, `Mails.create` is accepted only for exactly one new message with `send: true` and the fields
`from`, `to`, `cc`, `bcc`, `subject`, `displayableParts`. Drafts, templates and saving to folders are refused.

Before sending, the client makes a harmless read (`Folders.get`), which renews an expired Kerio session. The send request
itself is made once and its outcome is classified:

| Outcome | Classification |
|---|---|
| No errors | `SENT` |
| Errors mentioning partial success | `SENT WITH WARNINGS` |
| Other errors from Kerio | `NOT SENT` (reported error) |
| Connection could not be established (DNS, refused, TLS, blocked address) | `NOT SENT` (never reached Kerio) |
| Timeout, dropped connection, malformed answer | `RESULT UNKNOWN` |

## Credentials and tokens

- Credentials entered on the sign-in page are verified with `Session.login` and then sealed (AES-256-GCM, 256-bit key
  `MCP_TOKEN_KEY`) into the authorization code and the tokens. The password is never written to disk or logs.
- Access tokens last 1 hour; refresh tokens 90 days and are renewed on every use.
- Authorization codes are single-use and bound to the PKCE challenge, the client and the redirect URI.
- **Revoking access:** remove the connector in the MCP client. To sign out everyone, change `MCP_TOKEN_KEY` and restart.
- **Residual risk:** an attacker who obtains a token from the MCP client *and* the server's `MCP_TOKEN_KEY` can decrypt the
  password. Protect `.env` (`chmod 600`, never commit it) and the server.

## Account permissions

Use a regular user account, never an administrator account. Read-only mode limits what this connector does; it does not
limit the credentials. Anyone holding the password can do everything the account allows through webmail or other clients.

## Network policy

- Kerio server addresses typed by users are normalized to an `https://` origin; `http://` and URLs with embedded
  credentials are rejected.
- Loopback, private (RFC 1918), carrier-grade NAT, link-local, multicast, documentation and IPv6 unique-local addresses
  are blocked. Host names are checked again when the connection is made, so DNS rebinding cannot bypass the check.
- `KERIO_ALLOWED_SERVERS` restricts connections to listed host names.
- Certificate verification uses the system roots plus an optional `KERIO_CA_FILE`; it cannot be turned off.
- `KERIO_ALLOW_PRIVATE_NETWORK=true` lifts the address block; use it only for local development.

## Reporting a vulnerability

Please report security issues privately to the repository owner instead of opening a public issue.
