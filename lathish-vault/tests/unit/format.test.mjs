import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../../public/assets/js/lib/format.js';
import { QUOTA_BYTES } from '../../lib/constants.js';

test('quota is exactly 1,000,000,000 bytes and displays as 1 GB', () => {
  assert.equal(QUOTA_BYTES, 1_000_000_000);
  assert.equal(formatBytes(QUOTA_BYTES), '1 GB');
});
test('formatBytes uses decimal units and never shows "1000 MB"', () => {
  assert.deepEqual([999, 1500, 12_345_678, 999_998_800].map(formatBytes), ['999 B', '1.5 KB', '12.3 MB', '1 GB']);
});
