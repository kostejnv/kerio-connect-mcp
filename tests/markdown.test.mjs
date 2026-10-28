import assert from 'node:assert/strict';
import test from 'node:test';

import { markdownToHtml } from '../dist/markdown-to-html.js';

test('paragraphs, kept line breaks, bold and italic', () => {
  assert.equal(
    markdownToHtml('Dobrý den,\n\nposílám **podklady** a *návrh*.\n\nS pozdravem\nPavel'),
    '<p>Dobrý den,</p><p>posílám <strong>podklady</strong> a <em>návrh</em>.</p><p>S pozdravem<br>Pavel</p>'
  );
});

test('lists and quotes, also right after a sentence without a blank line', () => {
  assert.equal(
    markdownToHtml('Podklady:\n- zpráva\n- faktura\n\n3. třetí\n4. čtvrtý\n\n> citace\n> pokračování'),
    '<p>Podklady:</p><ul><li>zpráva</li><li>faktura</li></ul><ol start="3"><li>třetí</li><li>čtvrtý</li></ol>' +
      '<blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">citace<br>pokračování</blockquote>'
  );
});

test('links: Markdown links, bare URLs, trailing punctuation and mailto', () => {
  assert.equal(
    markdownToHtml('[Zpráva](https://drive.google.com/file/d/abc/view?usp=sharing&x=1), viz https://example.com/a. Napište na mailto:jan@example.com'),
    '<p><a href="https://drive.google.com/file/d/abc/view?usp=sharing&amp;x=1">Zpráva</a>, viz ' +
      '<a href="https://example.com/a">https://example.com/a</a>. Napište na <a href="mailto:jan@example.com">mailto:jan@example.com</a></p>'
  );
  assert.equal(
    markdownToHtml('(https://example.com/c) a https://en.wikipedia.org/wiki/Foo_(bar)'),
    '<p>(<a href="https://example.com/c">https://example.com/c</a>) a ' +
      '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">https://en.wikipedia.org/wiki/Foo_(bar)</a></p>'
  );
});

test('a link whose text looks like another address shows its real target', () => {
  assert.equal(
    markdownToHtml('[https://drive.google.com/x](https://evil.example/x) [drive.google.com](https://drive.google.com/)'),
    '<p><a href="https://evil.example/x">https://evil.example/x</a> <a href="https://drive.google.com/">drive.google.com</a></p>'
  );
});

test('HTML, other link schemes and unsupported syntax stay plain text', () => {
  assert.equal(
    markdownToHtml('<img src=x onerror=alert(1)> [klik](javascript:alert(1)) "quote" 2 * 3 * 4\n# Nadpis'),
    '<p>&lt;img src=x onerror=alert(1)&gt; [klik](javascript:alert(1)) &quot;quote&quot; 2 * 3 * 4<br># Nadpis</p>'
  );
  assert.equal(
    markdownToHtml('[x](https://a.example/"onmouseover="alert(1))'),
    '<p>[x](<a href="https://a.example/">https://a.example/</a>&quot;onmouseover=&quot;alert(1))</p>'
  );
});

test('Windows line breaks and surrounding blank lines', () => {
  assert.equal(markdownToHtml('\r\n\r\nA\r\nB\r\n\r\n\r\nC\r\n'), '<p>A<br>B</p><p>C</p>');
});
