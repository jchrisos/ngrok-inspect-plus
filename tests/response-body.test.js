'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitRawResponse, decodeBytes, classifyBody } = require('../content/response-body.js');

test('splitRawResponse separates head and body on CRLFCRLF', () => {
  const raw = 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nhello';
  const { head, body } = splitRawResponse(raw);
  assert.equal(head, 'HTTP/1.1 200 OK\r\nContent-Type: text/plain');
  assert.equal(body, 'hello');
});

test('splitRawResponse: no separator -> whole thing is head, body empty', () => {
  const { head, body } = splitRawResponse('HTTP/1.1 204 No Content');
  assert.equal(head, 'HTTP/1.1 204 No Content');
  assert.equal(body, '');
});

test('splitRawResponse preserves body CRLF bytes', () => {
  const { body } = splitRawResponse('HTTP/1.1 200 OK\r\n\r\nline1\r\nline2');
  assert.equal(body, 'line1\r\nline2');
});

test('decodeBytes honours a declared non-UTF-8 charset (iso-8859-1)', () => {
  const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]); // "café" in latin-1
  const dec = decodeBytes(bytes, 'iso-8859-1');
  assert.equal(dec.ok, true);
  assert.equal(dec.text, 'café');
});

test('decodeBytes falls back to utf-8 when the label is unknown', () => {
  const dec = decodeBytes(new TextEncoder().encode('ok'), 'not-a-charset');
  assert.equal(dec.ok, true);
  assert.equal(dec.text, 'ok');
});

test('decodeBytes reports failure for genuine binary', () => {
  const dec = decodeBytes(Uint8Array.from([0xff, 0xfe, 0x80]), 'utf-8');
  assert.equal(dec.ok, false);
});

test('classifyBody: text path is trusted as-is', () => {
  assert.deepEqual(classifyBody({ kind: 'text', text: '{"a":1}' }), { class: 'text', text: '{"a":1}' });
});

test('classifyBody: hex bytes that decode -> text; that do not -> binary', () => {
  assert.equal(classifyBody({ kind: 'bytes', bytes: new TextEncoder().encode('hi') }).class, 'text');
  assert.equal(classifyBody({ kind: 'bytes', bytes: Uint8Array.from([0xff, 0xfe]) }).class, 'binary');
});

test('classifyBody: unavailable stays unavailable', () => {
  assert.deepEqual(classifyBody({ kind: 'unavailable' }), { class: 'unavailable' });
});

test('classifyBody: binary carries the raw bytes for the caller to ignore', () => {
  const bytes = Uint8Array.from([0xff, 0xfe]);
  assert.deepEqual(classifyBody({ kind: 'bytes', bytes }), { class: 'binary', bytes });
});
