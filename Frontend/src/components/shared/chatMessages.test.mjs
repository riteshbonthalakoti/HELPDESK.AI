import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeChatMessages } from './chatMessages.mjs';
test('reconnect recovery deduplicates durable messages without losing recent events', () => {
  const first = { id: '1', created_at: '2026-01-01', message: 'old' };
  const second = { id: '2', created_at: '2026-01-02', message: 'new' };
  assert.deepEqual(mergeChatMessages([second, first], [first]), [first, second]);
});
test('internal and public records with the same ID remain distinct', () => {
  const publicMessage = { id: '1', created_at: '2026-01-01' };
  const internalMessage = { ...publicMessage, is_internal: true };
  assert.equal(mergeChatMessages([publicMessage], [internalMessage]).length, 2);
});
