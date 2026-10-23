/**
 * In-process HTTPS mock of the Kerio Connect client JSON-RPC API.
 * Records every call so tests can assert which methods were (not) used.
 */

import { readFileSync } from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';

const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

export const TEST_CA = fixture('ca.pem');
export const READ_METHODS = ['Session.login', 'Folders.get', 'Mails.get', 'Mails.getById', 'GET attachment'];

export const INBOX = 'keriostorage://folder/example.com/jan/inbox';
export const SENT = 'keriostorage://folder/example.com/jan/sent';
export const FOLDERS = [
  { id: 'keriostorage://folder/example.com/jan/root', name: 'Mailbox', type: 'FRoot' },
  { id: INBOX, name: 'INBOX', type: 'FMail', subType: 'FSubInbox', parentId: 'keriostorage://folder/example.com/jan/root' },
  { id: SENT, name: 'Sent Items', type: 'FMail', subType: 'FSubSentItems', parentId: 'keriostorage://folder/example.com/jan/root' },
  { id: 'keriostorage://folder/example.com/jan/projects', name: 'Projects', type: 'FMail', subType: 'FSubNone', parentId: INBOX },
  { id: 'keriostorage://folder/example.com/jan/calendar', name: 'Calendar', type: 'FCalendar' },
];

export const attachmentFixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

const pad = (n) => String(n).padStart(2, '0');
/** Kerio-style UTC date: 20190304T102200+0000 */
export function kerioDate(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+0000`;
}

/**
 * Builds `count` mails, newest first, one per day going back from 2026-10-01.
 * `overrides(index)` may change fields of individual mails.
 */
export function makeMails(count, overrides = () => ({})) {
  const newest = Date.UTC(2026, 9, 1, 9, 0, 0);
  return Array.from({ length: count }, (_, index) => ({
    id: `keriostorage://mail/example.com/jan/inbox/${100000 - index}`,
    folderId: 'keriostorage://folder/example.com/jan/inbox',
    from: { name: `Sender ${index}`, address: `sender${index}@example.org` },
    to: [{ name: 'Jan', address: 'jan@example.com' }],
    cc: [],
    subject: `Message ${index}`,
    receiveDate: kerioDate(new Date(newest - index * 24 * 3600 * 1000)),
    isSeen: true,
    isFlagged: false,
    hasAttachment: false,
    size: 1000,
    displayableParts: [{ contentType: 'ctTextPlain', content: `Body of message ${index}` }],
    ...overrides(index),
  }));
}

/**
 * @param files map of attachment download path → Buffer, served at that path for valid sessions
 */
export async function startMockKerio({ mails = makeMails(10), files = {}, username = 'jan@example.com', password = 'secret' } = {}) {
  const state = {
    mails,
    files,
    calls: [],
    sessions: new Set(),
    logins: 0,
    sent: [],
    /** 'ok' | 'partial' | 'fail' | 'hang' | 'drop' | 'session-expired' */
    sendBehavior: 'ok',
  };

  const reply = (res, body, headers = {}) => {
    res.writeHead(200, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  const handle = (rpc, req, res) => {
    const { method, params, id } = rpc;
    state.calls.push({ method, params });
    const ok = (result, headers) => reply(res, { jsonrpc: '2.0', id, result }, headers);
    const fail = (code, message) => reply(res, { jsonrpc: '2.0', id, error: { code, message } });

    if (method === 'Session.login') {
      if (params.userName !== username || params.password !== password) return fail(1000, 'Invalid user name or password.');
      state.logins++;
      const token = crypto.randomUUID();
      state.sessions.add(token);
      return ok({ token }, { 'Set-Cookie': `SESSION_CONNECT_WEBMAIL=cookie-${token}; Path=/; Secure; HttpOnly` });
    }

    const token = req.headers['x-token'];
    const cookie = req.headers.cookie ?? '';
    if (!state.sessions.has(token) || !cookie.includes(`SESSION_CONNECT_WEBMAIL=cookie-${token}`)) {
      return fail(-32001, 'Session expired.');
    }

    switch (method) {
      case 'Folders.get':
        return ok({ list: FOLDERS });

      case 'Mails.get': {
        const { folderIds, query } = params;
        let list = state.mails.filter((mail) => folderIds.includes(mail.folderId));
        for (const condition of query.conditions ?? []) {
          if (condition.fieldName !== 'QUICKSEARCH') return fail(-32602, `Unsupported condition ${condition.fieldName}`);
          const needle = condition.value.toLowerCase();
          list = list.filter((mail) =>
            [mail.subject, mail.from?.name, mail.from?.address, ...mail.displayableParts.map((p) => p.content)]
              .some((value) => (value ?? '').toLowerCase().includes(needle))
          );
        }
        list.sort((a, b) => b.receiveDate.localeCompare(a.receiveDate));
        const page = list.slice(query.start, query.start + query.limit).map((mail) =>
          Object.fromEntries(query.fields.filter((field) => field in mail).map((field) => [field, mail[field]]))
        );
        return ok({ list: page, totalItems: list.length });
      }

      case 'Mails.getById': {
        const result = [];
        const errors = [];
        params.ids.forEach((mailId, inputIndex) => {
          const mail = state.mails.find((item) => item.id === mailId);
          if (mail) result.push(structuredClone(mail));
          else errors.push({ inputIndex, code: -32602, message: 'Item not found' });
        });
        return ok({ result, errors });
      }

      case 'Mails.create': {
        state.sent.push(params.mails[0]);
        switch (state.sendBehavior) {
          case 'ok':
            return ok({ errors: [], result: [{ inputIndex: 0 }] });
          case 'partial':
            return ok({ errors: [{ inputIndex: 0, code: 'ErrorCodePartialSuccess', message: 'Partial success: the message was sent but could not be saved to Sent Items' }], result: [] });
          case 'fail':
            return ok({ errors: [{ inputIndex: 0, code: 'ErrorCodeSendingFailed', message: 'Sending failed' }], result: [] });
          case 'hang':
            return; // never answer
          case 'drop':
            return req.socket.destroy();
          case 'session-expired':
            return fail(-32001, 'Session expired.');
        }
        return;
      }

      default:
        return fail(-32601, `Method ${method} not implemented in mock`);
    }
  };

  const serveAttachment = (req, res) => {
    state.calls.push({ method: 'GET attachment', params: { path: req.url } });
    const cookie = req.headers.cookie ?? '';
    if (![...state.sessions].some((token) => cookie.includes(`SESSION_CONNECT_WEBMAIL=cookie-${token}`))) {
      res.writeHead(401).end();
      return;
    }
    const data = state.files[decodeURI(req.url)];
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
  };

  const server = https.createServer({ key: fixture('server-key.pem'), cert: fixture('server.pem') }, (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/webmail/api/download/attachment/')) {
      serveAttachment(req, res);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/webmail/api/jsonrpc') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handle(JSON.parse(body), req, res));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    state,
    url: `https://localhost:${port}`,
    ipUrl: `https://127.0.0.1:${port}`,
    username,
    password,
    expireSessions: () => state.sessions.clear(),
    callsOf: (method) => state.calls.filter((call) => call.method === method),
    nonReadCalls: () => state.calls.filter((call) => !READ_METHODS.includes(call.method)),
    close: () => {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
