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
- disabled sending: not listed, direct call refused, client refuses, no requests, no drafts;
- enabled sending, partial success, reported failure, timeout and dropped connection without retries;
- certificate verification, custom CA, private address blocking, session renewal;
- the OAuth flow with PKCE, token refresh, send opt-in and master switch; the landing page.

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

## Not yet verified

| # | Behaviour | Affects | If wrong |
|---|---|---|---|
| 1 | An expired session (after idle time) is reported like a missing one | session renewal | Errors after idle time instead of a silent re-login |
| 2 | Partial success of `Mails.create` mentions "partial" in the error code or message | `SENT WITH WARNINGS` | Reported as `NOT SENT` although it was sent |
| 3 | Kerio accepts `from` = the username when it is an e-mail address, and fills in the sender otherwise | `mail_send` | Sending fails or uses an unexpected sender |
| 4 | `mail_attachment_link` links open from Claude Code (`curl`) and from a browser | downloads | Links fail although reading attachments works |
| 5 | In a ChatGPT workspace, each member signs in with their own account | per-user access | Members would share the admin's connection |

## Checklist

Use a regular (non-administrator) account.

1. **Integration test** (read-only, never sends):
   ```bash
   KERIO_INTEGRATION=1 KERIO_SERVER=mail.example.com KERIO_USERNAME=... KERIO_PASSWORD=... npm run test:integration
   ```
2. **Downloads** (4): ask the assistant for the attachments of a message with several files; open one link and the ZIP.
3. **Idle session** (1): search again after more than the Kerio session timeout.
4. **ChatGPT workspace** (5): a colleague connects; their results must show `Mailbox owner: <their address>`.
5. **Sending** (2, 3, only when needed): enable it, connect with the checkbox ticked, send one message to your own
   address, and check the Sent folder.

Record the results here, including the Kerio Connect version tested.
