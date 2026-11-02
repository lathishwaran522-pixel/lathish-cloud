import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentDisposition, contentTypeFor, extensionOf, parseListQuery, parseSize, previewKind, sanitizeName, validatePassword } from '../../lib/validation/index.js';

test('sanitizeName', () => {
  assert.equal(sanitizeName('a/b\\c.txt'), 'a_b_c.txt');
  assert.equal(sanitizeName('  spaced.pdf  '), 'spaced.pdf');
  assert.equal(sanitizeName('..'), '_');
  assert.equal(sanitizeName('evil\u202egnp.exe'), 'evil_gnp.exe');
  assert.throws(() => sanitizeName('a/b', { strict: true }));
  assert.throws(() => sanitizeName('..', { strict: true }));
  assert.throws(() => sanitizeName(5));
  const long = sanitizeName(`${'x'.repeat(400)}.pdf`);
  assert.equal([...long].length, 255); assert.ok(long.endsWith('.pdf'));
});
test('types come from the extension only', () => {
  assert.equal(contentTypeFor('x.PDF'), 'application/pdf');
  assert.equal(contentTypeFor('page.html'), 'text/plain');
  assert.equal(contentTypeFor('noext'), 'application/octet-stream');
  assert.equal(extensionOf('.bashrc'), ''); assert.equal(extensionOf('a.tar.gz'), 'gz');
  assert.equal(previewKind('image/png'), 'image'); assert.equal(previewKind('text/html'), null); assert.equal(previewKind('application/zip'), null);
});
test('size and password limits', () => {
  assert.equal(parseSize(1_000_000_000), 1_000_000_000);
  assert.throws(() => parseSize(1_000_000_001)); assert.throws(() => parseSize(0)); assert.throws(() => parseSize('5'));
  assert.throws(() => validatePassword('short')); assert.equal(validatePassword('a-long-enough-password'), 'a-long-enough-password');
});
test('list query is whitelisted', () => {
  assert.equal(parseListQuery({ q: 'inv', view: 'folder' }).view, 'search');
  assert.throws(() => parseListQuery({ sort: 'name; drop table' }));
  assert.throws(() => parseListQuery({ view: 'x' }));
  assert.throws(() => parseListQuery({ parent: 'abc' }));
  assert.equal(parseListQuery({ limit: '9999' }).limit, 200);
});
test('content-disposition cannot be header-injected', () => {
  const d = contentDisposition('attachment', 'a"\r\nSet-Cookie: x=1.txt');
  assert.ok(!/[\r\n]/.test(d)); assert.ok(!d.includes('"a"'));
});
