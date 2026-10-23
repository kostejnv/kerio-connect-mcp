import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeToolArguments } from '../dist/tool-arguments.js';
import { MailSearchSchema, MailSendSchema, getMailToolDefinitions } from '../dist/mail-tools.js';

const schemaFor = (name) => {
  const definition = getMailToolDefinitions(true).find((tool) => tool.name === name);
  assert.ok(definition, `Missing tool definition: ${name}`);
  return definition.inputSchema;
};

test('normalizes Qwen-style numeric and boolean arguments using the advertised tool schema', () => {
  const raw = { limit: '5', offset: '40', unreadOnly: 'true' };
  const normalized = normalizeToolArguments(raw, schemaFor('mail_search'));

  assert.deepEqual(normalized, { limit: 5, offset: 40, unreadOnly: true });
  assert.equal(MailSearchSchema.parse(normalized).limit, 5);
  assert.deepEqual(raw, { limit: '5', offset: '40', unreadOnly: 'true' });
});

test('normalizes double-serialized recipient arrays', () => {
  const normalized = normalizeToolArguments(
    { to: '["timon@example.com"]', subject: 'MCP-Test', body: 'Danke für den Test.' },
    schemaFor('mail_send')
  );

  assert.deepEqual(normalized.to, ['timon@example.com']);
  assert.deepEqual(MailSendSchema.parse(normalized).to, ['timon@example.com']);
});

test('keeps ordinary strings and invalid values untouched', () => {
  const normalized = normalizeToolArguments({ query: '42', limit: 'many' }, schemaFor('mail_search'));
  assert.deepEqual(normalized, { query: '42', limit: 'many' });
  assert.throws(() => MailSearchSchema.parse(normalized));
});
