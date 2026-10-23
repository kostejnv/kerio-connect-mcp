/**
 * Sign-in page shown during OAuth authorization.
 * English by default; a CSS-only switch (no scripts, so a strict CSP stays possible) shows Czech.
 */

import type { Response } from 'express';
import type { PendingAuthorization } from './oauth-provider.js';

/** Text in both page languages. */
export interface LocalizedText {
  en: string;
  cs: string;
}

export interface LoginPageOptions {
  authRequest: string;
  pending: PendingAuthorization;
  /** Whether the server allows connections to opt in to sending. */
  sendOptionAvailable: boolean;
  values?: { server?: string; username?: string };
  error?: LocalizedText;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders already-escaped HTML in both languages; only the selected one is visible. */
function localized(text: LocalizedText): string {
  return `<span lang="en" class="en">${text.en}</span><span lang="cs" class="cs">${text.cs}</span>`;
}

const STYLES = `
  :root { color-scheme: light dark; --bg: #f4f5f7; --card: #fff; --text: #1d2330; --muted: #5d6675; --line: #d5d9e0; --accent: #1f5fbf; --error: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg: #14171c; --card: #1d2128; --text: #e7e9ee; --muted: #9aa3b2; --line: #343a45; --accent: #6ea2f0; --error: #f97066; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 420px; margin: 6vh auto; padding: 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  .lang { display: flex; justify-content: flex-end; gap: 4px; margin-bottom: 8px; font-size: .85rem; }
  .lang input { position: absolute; opacity: 0; pointer-events: none; }
  .lang label { padding: 2px 8px; border-radius: 6px; color: var(--muted); cursor: pointer; font-weight: 600; }
  #lang-en:checked ~ label[for=lang-en], #lang-cs:checked ~ label[for=lang-cs] { background: var(--line); color: var(--text); }
  body:has(#lang-cs:checked) .en, body:not(:has(#lang-cs:checked)) .cs { display: none; }
  h1 { font-size: 1.3rem; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 20px; }
  form label { display: block; font-weight: 600; margin-bottom: 14px; }
  input[type=text], input[type=password] { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 10px 12px; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 8px; }
  form label.check { font-weight: 500; }
  .check small { display: block; color: var(--muted); font-weight: 400; margin-left: 24px; }
  button { width: 100%; padding: 11px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
  .error { color: var(--error); margin-bottom: 16px; }
  .note { font-size: .85rem; margin: 16px 0 0; }
`;

const LANGUAGE_SWITCH = `
    <div class="lang">
      <input type="radio" name="lang" id="lang-en" checked><input type="radio" name="lang" id="lang-cs">
      <label for="lang-en">EN</label><label for="lang-cs">CS</label>
    </div>`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
  <div class="card">${LANGUAGE_SWITCH}
${body}
  </div>
</main>
</body>
</html>`;
}

export function sendLoginPage(res: Response, options: LoginPageOptions, status = 200): void {
  const redirectOrigin = new URL(options.pending.redirectUri).origin;
  const client = `<strong>${escapeHtml(options.pending.clientName ?? 'MCP client')}</strong>`;
  const clientHost = escapeHtml(new URL(options.pending.redirectUri).host);
  const sendOption = options.sendOptionAvailable
    ? `<label class="check"><input type="checkbox" name="allowSend"> ${localized({ en: 'Allow sending e-mails', cs: 'Povolit odesílání e-mailů' })}
        <small>${localized({
          en: 'Unchecked, the assistant can only read mail. This cannot be changed by the assistant later, only by connecting again.',
          cs: 'Bez zaškrtnutí může asistent poštu jen číst. Volbu nelze později změnit z asistenta, jen novým připojením.',
        })}</small></label>`
    : '';
  const error = options.error
    ? `<div class="error" role="alert">${localized({ en: escapeHtml(options.error.en), cs: escapeHtml(options.error.cs) })}</div>`
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
    .send(page('Connect to Kerio Connect', `
    <h1>${localized({ en: 'Connect to Kerio Connect', cs: 'Připojení ke Kerio Connect' })}</h1>
    <p>${localized({
      en: `${client} (${clientHost}) is requesting access to your mailbox.`,
      cs: `${client} (${clientHost}) žádá o přístup k vaší poště.`,
    })}</p>
    ${error}
    <form method="post" action="/login" autocomplete="on">
      <input type="hidden" name="request" value="${escapeHtml(options.authRequest)}">
      <label>${localized({ en: 'Kerio server', cs: 'Kerio server' })}
        <input type="text" name="server" required placeholder="mail.example.com" value="${escapeHtml(options.values?.server ?? '')}">
      </label>
      <label>${localized({ en: 'Username', cs: 'Uživatelské jméno' })}
        <input type="text" name="username" required autocomplete="username" value="${escapeHtml(options.values?.username ?? '')}">
      </label>
      <label>${localized({ en: 'Password', cs: 'Heslo' })}
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      ${sendOption}
      <button type="submit">${localized({ en: 'Sign in and allow access', cs: 'Přihlásit a povolit přístup' })}</button>
    </form>
    <p class="note">${localized({
      en: `Your password is not stored on the server. It is only kept encrypted inside the access token held by ${client}.`,
      cs: `Heslo se neukládá na server. Je zašifrované jen v přístupovém tokenu, který drží ${client}.`,
    })}</p>`));
}

export function sendErrorPage(res: Response, status: number, message: LocalizedText): void {
  res
    .status(status)
    .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" })
    .send(page('Sign-in error', `<p>${localized({ en: escapeHtml(message.en), cs: escapeHtml(message.cs) })}</p>`));
}
