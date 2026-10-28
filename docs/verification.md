# Verification status

## Verified against the simulated Kerio API

`npm test` runs against an HTTPS mock built from the official
[client API reference](https://manuals.gfi.com/en/kerio/api/connect/client/reference/index.html) and from what the real
server returned (below):

- reading a message far beyond the newest 500 by ID, complete long bodies in parts, the HTML-plus-preview body shape;
- complete filtered searches, exact paging, direction labels and copies of sent mail;
- attachments: PDF, DOCX, XLSX, text and images; size limits; only the server's download path; long text in parts;
- download links: original bytes, ZIP contents, headers, tampered and foreign tickets refused;
- read operations use only read methods and leave seen state unchanged;
- drafts: new drafts, replies and reply all, attachments copied by ID, updates that keep text, quote and attachments,
  only drafts editable, writes never retried, the client refusing everything but one draft with `send: false`;
- the Markdown subset for draft text and its escaping;
- certificate verification, custom CA, private address blocking, session renewal;
- the OAuth flow with PKCE, token refresh, no send tool; the landing page.

## Verified against a real server

**Kerio Connect 10.0.8 patch 2** (a production installation with a self-signed certificate trusted through
`KERIO_CA_FILE`), through the deployed server and Claude Code, October 2026:

| Behaviour | Result |
|---|---|
| TLS | accepted with `KERIO_CA_FILE`, rejected without it |
| Missing session | `{"code": -32001, "message": "Session expired."}` |
| Folders | `Folders.get` lists INBOX, Sent Items, Drafts, Deleted Items, Junk E-mail and own folders |
| Search | `Mails.get` over all folders (over 100,000 messages) returns `totalItems` and sorts newest first; `QUICKSEARCH` works; date filters with early stop work |
| `receiveDate` | parsed correctly |
| Reading | `Mails.getById` returns the full text as an HTML part plus a ~90 character plain-text preview; an unread message stays unread after `mail_get` |
| `Mails.getPageWithId` | returns no text parts (not used) |
| Direction | sent mail is stored in Sent Items **and** copied into INBOX; INBOX also holds copies of mail addressed to colleagues |
| Attachments | `mail_get_attachment` downloads through the attachment URL with the session cookies and extracts a 3-page PDF |
| Spam | Kerio's antispam moves spam to Junk E-mail and prefixes `**SPAM**`; such prefixes also survive in subjects of ordinary replies |
| Download links | links from `mail_attachment_link` download the original PDFs with `curl` from Claude Code |

### Drafts

Checked directly against the JSON-RPC API with test drafts addressed only to the mailbox owner, before the draft tools
were built (October 2026). Nothing was sent: Sent Items and INBOX were unchanged afterwards.

| Behaviour | Result |
|---|---|
| `Mails.create` with `send: false`, no `folderId` | saved in Drafts with `isDraft: true`; returns `{ result: [{ id, watermark }], errors: [] }` |
| `from` = the username (an e-mail address) | accepted |
| HTML body (`ctTextHtml`) | stored as given; Kerio adds the plain-text part itself; Webmail shows it correctly |
| `Mails.set` with `id`, `send: false` and new subject, To, Cc and body | changed in place: same ID, still a draft in Drafts, no copy; returns an empty `id` |
| Message-ID of a message | `Mails.getById` and `Mails.get` return `headers: [{ type: "mhMessageID", value }]`; replies have `mhInReplayTo` (sic) |
| `headers: [{ type: "mhInReplayTo", value }]` on create | accepted and kept on the draft; Kerio adds its own `mhMessageID` |
| `mhReferences` | not a header type: `Invalid value for enum MimeHeaderType`, and the whole call is rejected |
| Attachment of another message by `{ id, name, contentType, size }` | copied into the draft (same name and size) without any upload |

Then through `mail_create_draft` and `mail_update_draft` (stdio, October 2026): a reply to the owner's own sent message,
addressed to the owner, with a PDF from another message, then a new text. The draft kept its ID, the PDF (same size),
the quote and `mhInReplayTo`; INBOX and Sent Items had the same number of messages before and after.

## Not yet verified

| # | Behaviour | Affects | If wrong |
|---|---|---|---|
| 1 | An expired session (after idle time) is reported like a missing one | session renewal | Errors after idle time instead of a silent re-login |
| 3 | A reply draft with `mhInReplayTo` is threaded by the recipient's mail program after sending from Webmail | replies | The reply arrives as a new conversation |
| 4 | `mail_attachment_link` links open in a browser | downloads | Links fail in the browser although `curl` works |
| 5 | In a ChatGPT workspace, each member signs in with their own account | per-user access | Members would share the admin's connection |

## Checklist

Use a regular (non-administrator) account.

1. **Integration test** (read-only, never sends):
   ```bash
   KERIO_INTEGRATION=1 KERIO_SERVER=mail.example.com KERIO_USERNAME=... KERIO_PASSWORD=... npm run test:integration
   ```
2. **Downloads** (4): ask the assistant for the attachments of a message with several files; open one link and the ZIP
   in a browser.
3. **Idle session** (1): search again after more than the Kerio session timeout.
4. **ChatGPT workspace** (5): a colleague connects; their results must show `Mailbox owner: <their address>`.
5. **Threading** (3): send a reply draft from Webmail to yourself and check that it is threaded.

Record the results here, including the Kerio Connect version tested.
