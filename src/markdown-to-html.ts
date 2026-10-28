/**
 * Converts the small Markdown subset accepted for draft bodies into HTML.
 *
 * Everything else is escaped: the text is written by an agent that also reads untrusted e-mails,
 * so it must not be able to add markup, images or scripts. Links are limited to http(s) and mailto.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text with its line breaks kept. */
export function plainTextToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
}

export const QUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex';

type LineKind = 'bullet' | 'numbered' | 'quote' | 'text';

const LINE_PATTERNS: Array<[LineKind, RegExp]> = [
  ['bullet', /^\s*[-*]\s+(.*)$/],
  ['numbered', /^\s*(\d+)[.)]\s+(.*)$/],
  ['quote', /^\s*>\s?(.*)$/],
];

interface Line {
  kind: LineKind;
  content: string;
  number?: number;
}

function classifyLine(line: string): Line {
  for (const [kind, pattern] of LINE_PATTERNS) {
    const match = line.match(pattern);
    if (!match) continue;
    return kind === 'numbered'
      ? { kind, content: match[2], number: Number(match[1]) }
      : { kind, content: match[1] };
  }
  return { kind: 'text', content: line };
}

/** Consecutive lines of the same kind, so a list may follow a sentence without a blank line. */
function groupLines(lines: Line[]): Line[][] {
  const groups: Line[][] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last[0].kind === line.kind) last.push(line);
    else groups.push([line]);
  }
  return groups;
}

function renderGroup(group: Line[]): string {
  const items = group.map((line) => renderInline(line.content));
  switch (group[0].kind) {
    case 'bullet':
      return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
    case 'numbered': {
      const start = group[0].number !== undefined && group[0].number !== 1 ? ` start="${group[0].number}"` : '';
      return `<ol${start}>${items.map((item) => `<li>${item}</li>`).join('')}</ol>`;
    }
    case 'quote':
      return `<blockquote style="${QUOTE_STYLE}">${items.join('<br>')}</blockquote>`;
    case 'text':
      return `<p>${items.join('<br>')}</p>`;
  }
}

export function markdownToHtml(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => groupLines(block.split('\n').map(classifyLine)).map(renderGroup).join(''))
    .join('');
}

// ============================================================================
// Inline: links, bold, italic
// ============================================================================

const LINK = /\[([^\]\n]+)\]\(([^()\s]+)\)|((?:https?:\/\/|mailto:)[^\s<>"]+)/gi;

function isAllowedUrl(url: string): boolean {
  if (!/^(https?:\/\/|mailto:)/i.test(url)) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/** Punctuation right after a bare URL usually ends the sentence, not the URL; ")" only when unbalanced. */
function splitTrailingPunctuation(url: string): [string, string] {
  let end = url.length;
  const count = (char: string) => url.slice(0, end).split(char).length - 1;
  while (end > 0) {
    const last = url[end - 1];
    if (!".,;:!?'\"".includes(last) && !(last === ')' && count(')') > count('('))) break;
    end--;
  }
  return [url.slice(0, end), url.slice(end)];
}

function looksLikeAddress(text: string): boolean {
  const trimmed = text.trim();
  return /^(https?:\/\/|mailto:|www\.)/i.test(trimmed) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed);
}

function comparableAddress(text: string): string {
  return text.trim().toLowerCase().replace(/^(https?:\/\/|mailto:)/, '').replace(/^www\./, '').replace(/\/$/, '');
}

/** A link whose text looks like an address but points elsewhere shows where it really leads. */
function linkLabel(text: string, url: string): string {
  return looksLikeAddress(text) && comparableAddress(text) !== comparableAddress(url) ? escapeHtml(url) : emphasis(escapeHtml(text));
}

function anchor(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}">${label}</a>`;
}

function emphasis(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?=[^\s*])([^*]+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>');
}

function renderInline(text: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    html += emphasis(escapeHtml(text.slice(last, match.index)));
    last = match.index + match[0].length;

    const [, label, target, bare] = match;
    if (bare) {
      const [url, trailing] = splitTrailingPunctuation(bare);
      html += (isAllowedUrl(url) ? anchor(url, escapeHtml(url)) : escapeHtml(url)) + escapeHtml(trailing);
    } else if (isAllowedUrl(target)) {
      html += anchor(target, linkLabel(label, target));
    } else {
      html += escapeHtml(match[0]);
    }
  }
  return html + emphasis(escapeHtml(text.slice(last)));
}
