# Security

## What the connector protects against

| Risk | Protection |
|---|---|
| Agent sends mail | Impossible: there is no send tool, and draft writes require `send: false`; separate write paths only permit read status or contact fields (below) |
| Agent changes or deletes mail | No tool for moving or deleting; message content changes are limited to drafts. Selected messages can explicitly be marked read/unread |
| Duplicate drafts after an error | Draft writes are never retried |
| Prompt injection through e-mails | Bodies and attachment text are marked as untrusted data; tool descriptions forbid acting on instructions in them; draft text cannot contain HTML, and links can only be http(s) or mailto |
| Hostile attachments | Parsed in an isolated worker (256 MB, 30 s), never executed; downloads only from the Kerio server's attachment path, 25 MB each |
| Download links leaking | Sealed, 10 minutes, one message's attachments only; served as downloads with `nosniff` and a sandbox CSP |
| Credentials stolen from the server | Nothing is stored; credentials exist only inside encrypted tokens held by the MCP client |
| Server abused as a proxy into private networks | https only, private/local addresses blocked (also after DNS resolution), optional host allowlist |
| Password guessing through the sign-in form | 10 sign-in attempts per IP per 15 minutes |
| Man-in-the-middle towards Kerio | TLS certificates are always verified |
| Secrets in logs | Logs contain no passwords, tokens, cookies or message content |

## Allowed Kerio API methods

The Kerio client accepts only these methods: `Session.login`, `Folders.get`, `Mails.get`, `Mails.getById` for reading,
plus `Contacts.get` / `Contacts.getById` for contacts. Draft writes use `Mails.create` / `Mails.set` (below).
Separate unexported capabilities permit `Mails.set` for one `{id, isSeen}` only, and
`Contacts.create` / `Contacts.set` for one ordinary contact with allowlisted fields.
Any other method is refused locally before a request is made. These mutation methods
are never admitted to the read allowlist. Attachment downloads are plain `GET` requests to the URL Kerio reports
for an attachment; the client accepts only URLs on the connected server under `/webmail/api/download/attachment/`.
Reading never changes a message.

## Download links

`mail_attachment_link` (remote mode) returns links of the form `/download/<ticket>/<file name>`. The ticket is sealed like
the OAuth tokens, with its own purpose, so it cannot be used as a token and a token cannot be used as a ticket. It holds
the credentials, the message ID and the attachment numbers, and expires after 10 minutes. Nothing is stored: opening the
link signs in to Kerio (or reuses the session), downloads the attachment(s) and passes them on, a single file unchanged
or several as a ZIP. Responses are always downloads (`Content-Disposition: attachment`), with `X-Content-Type-Options:
nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: no-store`, so an HTML attachment cannot run on the
server's origin. Anyone holding a link during its 10 minutes can download those attachments; treat links like the files.

## Drafts

The connector cannot send e-mail. Outgoing messages are saved as drafts, which
the user reviews and sends from Kerio Webmail. There is no setting to enable sending.

- In the draft path, `Mails.create` and `Mails.set` are accepted only for exactly one message with `send: false` and the fields `from`,
  `to`, `cc`, `bcc`, `subject`, `displayableParts`, `attachments`, `headers`. `Mails.set` must name the draft by `id`;
  `Mails.create` must not. Anything else, such as `send: true`, a `folderId` or flags, is refused before a request is
  made.
- `mail_update_draft` changes a message only if it is in the Drafts folder and Kerio marks it as a draft, so received
  and sent mail cannot be edited.
- Before writing, the client makes a harmless read (`Folders.get`), which renews an expired Kerio session. The write
  itself is made once; a failure or timeout is reported, never repeated.
- Draft text is converted from a small Markdown subset; everything else is escaped. Links are limited to `https`, `http`
  and `mailto`, and a link whose text looks like an address shows its real target. Quoted originals in replies are
  inserted as escaped plain text.
- Attachments can only be copied from messages already in the mailbox, by their Kerio attachment IDs. The connector does
  not upload or fetch files from elsewhere.

## Credentials and tokens

- Credentials entered on the sign-in page are verified with `Session.login` and then sealed (AES-256-GCM, 256-bit key
  `MCP_TOKEN_KEY`) into the authorization code and the tokens. The password is never written to disk or logs.
- Access tokens last 1 hour; refresh tokens 90 days and are renewed on every use.
- Authorization codes are single-use and bound to the PKCE challenge, the client and the redirect URI.
- **Revoking access:** remove the connector in the MCP client. To sign out everyone, change `MCP_TOKEN_KEY` and restart.
- **Residual risk:** an attacker who obtains a token from the MCP client *and* the server's `MCP_TOKEN_KEY` can decrypt the
  password. Protect `.env` (`chmod 600`, never commit it) and the server.

## Account permissions

Use a regular user account, never an administrator account. The connector limits what it does itself; it does not
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

## Explicit read status and contact writes

The read-status path permits exactly one ID and boolean `isSeen` per API write;
it cannot pass `send`, content, recipients, folders or any other flags. The public
tool accepts up to 100 IDs, deduplicates them and verifies each after writing.
Partial failures are reported per ID. No folder-wide read-status operation exists.

Contact writes permit only the supported name/company/job, address/phone lists,
birthday and notes fields in an accessible contact folder. Updates cannot change
folder, contact type, GAL records or distribution lists. Unsupported and omitted
fields are not sent. Supplied lists deliberately replace the whole list. The
server enforces access rights; the connector does not grant extra permissions.

All new writes are performed once, never retried automatically. Unknown results
must be checked before retrying, especially creation. Contact data is untrusted
and does not authorize actions. User confirmation and duplicate checking are
agent instructions, not a server-side authorization protocol; annotations are
hints, not a consent enforcement mechanism. See [Tools](tools.md) for semantics
and [Verification](verification.md) for outstanding real-server checks.
