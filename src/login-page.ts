/**
 * Sign-in page shown during OAuth authorization.
 */

import type { Response } from 'express';
import type { PendingAuthorization } from './oauth-provider.js';

export interface LoginPageOptions {
  authRequest: string;
  pending: PendingAuthorization;
  /** Whether the server allows connections to opt in to sending. */
  sendOptionAvailable: boolean;
  values?: { server?: string; username?: string };
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sendLoginPage(res: Response, options: LoginPageOptions, status = 200): void {
  const redirectOrigin = new URL(options.pending.redirectUri).origin;
  const clientName = options.pending.clientName ?? 'MCP klient';
  const sendOption = options.sendOptionAvailable
    ? `<label class="check"><input type="checkbox" name="allowSend"> Povolit odesílání e-mailů
        <small>Bez zaškrtnutí může asistent poštu jen číst. Volbu nelze později změnit z asistenta, jen novým připojením.</small></label>`
    : '';

  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      // form-action must also allow the redirect back to the MCP client after sign-in.
      'Content-Security-Policy':
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${redirectOrigin}; frame-ancestors 'none'; base-uri 'none'`,
    })
    .send(`<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Připojení ke Kerio Connect</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f5f7; --card: #fff; --text: #1d2330; --muted: #5d6675; --line: #d5d9e0; --accent: #1f5fbf; --error: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14171c; --card: #1d2128; --text: #e7e9ee; --muted: #9aa3b2; --line: #343a45; --accent: #6ea2f0; --error: #f97066; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 420px; margin: 8vh auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  h1 { font-size: 1.3rem; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 20px; }
  label { display: block; font-weight: 600; margin-bottom: 14px; }
  input[type=text], input[type=password] { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; }
  .check { font-weight: 500; }
  .check small { display: block; color: var(--muted); font-weight: 400; margin-left: 24px; }
  button { width: 100%; padding: 11px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
  .error { color: var(--error); margin-bottom: 16px; }
  .note { font-size: .85rem; margin: 16px 0 0; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Připojení ke Kerio Connect</h1>
    <p><strong>${escapeHtml(clientName)}</strong> (${escapeHtml(new URL(options.pending.redirectUri).host)}) žádá o přístup k vaší poště.</p>
    ${options.error ? `<div class="error" role="alert">${escapeHtml(options.error)}</div>` : ''}
    <form method="post" action="/login" autocomplete="on">
      <input type="hidden" name="request" value="${escapeHtml(options.authRequest)}">
      <label>Kerio server
        <input type="text" name="server" required placeholder="mail.firma.cz" value="${escapeHtml(options.values?.server ?? '')}">
      </label>
      <label>Uživatelské jméno
        <input type="text" name="username" required autocomplete="username" value="${escapeHtml(options.values?.username ?? '')}">
      </label>
      <label>Heslo
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      ${sendOption}
      <button type="submit">Přihlásit a povolit přístup</button>
    </form>
    <p class="note">Heslo se neukládá na server. Je zašifrované jen v přístupovém tokenu, který drží ${escapeHtml(clientName)}.</p>
  </div>
</main>
</body>
</html>`);
}

export function sendErrorPage(res: Response, status: number, message: string): void {
  res
    .status(status)
    .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" })
    .send(`<!doctype html><html lang="cs"><meta charset="utf-8"><title>Chyba přihlášení</title>` +
      `<body style="font-family:system-ui;max-width:420px;margin:10vh auto;padding:0 16px"><p>${escapeHtml(message)}</p></body></html>`);
}
