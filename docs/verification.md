# Verification status

## Verified

Against the **simulated Kerio API** (`npm test`), built from the official
[client API reference](https://manuals.gfi.com/en/kerio/api/connect/client/reference/index.html):

- reading a message far beyond the newest 500 by ID;
- complete long bodies, in parts with explicit continuation;
- complete filtered searches and exact paging;
- read operations use only read methods and leave seen state unchanged;
- disabled sending: not listed, direct call refused, client refuses, no requests, no drafts;
- enabled sending, partial success, reported failure, timeout and dropped connection without retries;
- certificate verification, custom CA, private address blocking, session renewal;
- the OAuth flow with PKCE, token refresh, send opt-in and master switch.

On the **deployed server**: valid HTTPS, OAuth metadata, dynamic client registration and the sign-in page.

## Not yet verified against a real Kerio server

These behaviours are not specified in Kerio's documentation and are assumptions:

| # | Assumption | Affects | If wrong |
|---|---|---|---|
| 1 | `Mails.getById` returns `displayableParts` and does not mark the message as seen | `mail_get` | Empty bodies, or reading marks messages as read |
| 2 | `receiveDate` looks like `20240115T093000+0100` (or ISO 8601) | date filters, date display | Date filters match nothing |
| 3 | `Mails.get` over several folders sorts by `receiveDate` descending and returns `totalItems` | search order, totals, early stop with `dateFrom` | Wrong order or totals (the early stop switches itself off if results are not newest first) |
| 4 | `QUICKSEARCH` with `Like` performs the full-text search | `query` | `query` finds nothing or errors |
| 5 | An expired session is reported with codes -32001 to -32003 or HTTP 401 | session renewal | Errors after idle time instead of a silent re-login |
| 6 | Partial success of `Mails.create` mentions "partial" in the error code or message | `SENT WITH WARNINGS` | Reported as `NOT SENT` although it was sent |
| 7 | Kerio accepts `from` = the username when it is an e-mail address, and fills in the sender otherwise | `mail_send` | Sending fails or uses an unexpected sender |

## Checklist for a real server

Use a regular (non-administrator) account.

1. **Integration test** (read-only, never sends):
   ```bash
   KERIO_INTEGRATION=1 KERIO_SERVER=mail.example.com KERIO_USERNAME=... KERIO_PASSWORD=... npm run test:integration
   ```
   It reads the oldest Inbox message, checks seen state, flags and folder did not change (assumption 1), and prints the
   date format (assumption 2).
2. **Connect a client** and ask it to:
   - list folders;
   - find an old message by sender and year (assumptions 2–4);
   - read a long message to the end;
   - search again after more than the Kerio session timeout (assumption 5).
3. **In webmail**, confirm an unread message the agent read is still unread.
4. **Sending** (only when needed): enable it, connect with the checkbox ticked, send one message to your own address,
   and check the Sent folder (assumptions 6–7).

Record the results here, including the Kerio Connect version tested.
