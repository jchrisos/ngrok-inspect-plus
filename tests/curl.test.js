'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sh, parseRawRequest, toCurl } = require('../content/curl.js');

test('sh quotes POSIX-ly, including embedded single quotes', () => {
  assert.equal(sh('abc'), "'abc'");
  assert.equal(sh("it's"), "'it'\\''s'");
  // $ ` " \ newline are literal inside single quotes -> unchanged
  assert.equal(sh('$HOME `id` "x" \\ y\nz'), "'$HOME `id` \"x\" \\ y\nz'");
});

test('parseRawRequest handles CRLF, duplicate headers and a body', () => {
  const raw =
    'POST /hello?x=1 HTTP/1.1\r\n' +
    'Host: test-extension.sa.ngrok.io\r\n' +
    'X-Multi: first\r\n' +
    'X-Multi: second\r\n' +
    'Content-Type: application/json\r\n' +
    '\r\n' +
    '{"name":"julio","n":2}';
  const r = parseRawRequest(raw);
  assert.equal(r.method, 'POST');
  assert.equal(r.target, '/hello?x=1');
  assert.equal(r.version, '1.1');
  assert.equal(r.headers.length, 4);
  assert.deepEqual(r.headers[2], { name: 'X-Multi', value: 'second' });
  assert.equal(r.body, '{"name":"julio","n":2}');
});

test('parseRawRequest preserves body CRLF bytes (no normalisation)', () => {
  const raw = 'PUT /e HTTP/1.1\r\nHost: h\r\n\r\nline1\r\nline2';
  assert.equal(parseRawRequest(raw).body, 'line1\r\nline2');
});

test('parseRawRequest tolerates LF-only line endings', () => {
  const r = parseRawRequest('GET /a HTTP/1.1\nHost: h\n\n');
  assert.equal(r.method, 'GET');
  assert.equal(r.target, '/a');
});

test('parseRawRequest returns null on a non-request line', () => {
  assert.equal(parseRawRequest('HTTP/1.1 200 OK\r\n\r\n'), null);
});

test('toCurl: method always explicit, URL quoted, drops Host/Content-Length, strips forwarded', () => {
  const req = {
    method: 'POST',
    target: '/hello?x=1',
    headers: [
      { name: 'Host', value: 'test-extension.sa.ngrok.io' },
      { name: 'X-Forwarded-For', value: '203.0.113.1' },
      { name: 'Content-Length', value: '24' },
      { name: 'Content-Type', value: 'application/json' },
    ],
    body: '{"name":"julio","n":2}',
    bodyKind: 'text',
  };
  const { command, warnings } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.equal(warnings.length, 0);
  assert.match(command, /^curl -X POST 'https:\/\/test-extension\.sa\.ngrok\.io\/hello\?x=1' \\\n/);
  assert.ok(command.includes("-H 'Content-Type: application/json'"));
  assert.ok(!command.includes('Host'));
  assert.ok(!command.includes('X-Forwarded-For'));
  assert.ok(!command.includes('Content-Length'));
  assert.ok(command.includes("--data-raw '{\"name\":\"julio\",\"n\":2}'"));
  assert.ok(!command.endsWith('\n'), 'no trailing newline');
});

test('toCurl: keeps duplicates in wire order; empty value -> Name;', () => {
  const req = {
    method: 'GET',
    target: '/e',
    headers: [
      { name: 'X-Multi', value: 'first' },
      { name: 'X-Multi', value: 'second' },
      { name: 'X-Empty', value: '' },
    ],
    bodyKind: 'empty',
  };
  const { command } = toCurl(req, { stripForwardedHeaders: false }, { origin: 'http://localhost:4040' });
  assert.ok(command.includes("-H 'X-Multi: first'"));
  assert.ok(command.includes("-H 'X-Multi: second'"));
  assert.ok(command.includes("-H 'X-Empty;'"));
  assert.ok(!command.includes('--data'));
  assert.ok(command.indexOf('first') < command.indexOf('second'), 'wire order preserved');
});

test('toCurl: unavailable body -> leading comment + headers only', () => {
  const req = {
    method: 'POST',
    target: '/big',
    headers: [{ name: 'Content-Type', value: 'text/plain' }],
    bodyKind: 'unavailable',
    byteLength: 100000,
  };
  const { command } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.ok(command.startsWith('# ngrok-inspect-plus: body not captured by ngrok (100000 bytes) — headers only\n'));
  assert.ok(!command.includes('--data'));
});

test('toCurl: binary body -> omitted with a comment, never raw bytes', () => {
  const req = {
    method: 'POST',
    target: '/binary',
    headers: [],
    bodyKind: 'binary',
    bodyBytes: Uint8Array.from([0, 1, 2, 255]),
    byteLength: 4,
  };
  const { command } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.ok(command.startsWith('# ngrok-inspect-plus: body omitted: 4 bytes, non-UTF-8\n'));
  assert.ok(!command.includes('--data'));
});

test('toCurl: single-line mode joins with spaces', () => {
  const req = { method: 'GET', target: '/', headers: [{ name: 'Accept', value: '*/*' }], bodyKind: 'empty' };
  // No Host header -> URL falls back to the page origin verbatim (R1).
  const { command } = toCurl(req, { multiline: false }, { origin: 'http://localhost:4040' });
  assert.equal(command, "curl -X GET 'http://localhost:4040/' -H 'Accept: */*'");
});

test('toCurl: URL scheme comes from the request (X-Forwarded-Proto), not a setting', () => {
  const req = {
    method: 'GET',
    target: '/x',
    headers: [
      { name: 'Host', value: 'example.sa.ngrok.io' },
      { name: 'X-Forwarded-Proto', value: 'http' },
    ],
    bodyKind: 'empty',
  };
  const { command } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.ok(command.includes("'http://example.sa.ngrok.io/x'"));
});

test('toCurl: falls back to https when X-Forwarded-Proto is absent', () => {
  const req = { method: 'GET', target: '/x', headers: [{ name: 'Host', value: 'h.ngrok.io' }], bodyKind: 'empty' };
  const { command } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.ok(command.includes("'https://h.ngrok.io/x'"));
});

test('toCurl: includeCompressed drops Accept-Encoding and adds --compressed', () => {
  const req = {
    method: 'GET',
    target: '/gz',
    headers: [
      { name: 'Accept-Encoding', value: 'gzip, deflate' },
      { name: 'Accept', value: '*/*' },
    ],
    bodyKind: 'empty',
  };
  const { command } = toCurl(req, { includeCompressed: true }, { origin: 'http://localhost:4040' });
  assert.ok(command.includes('--compressed'));
  assert.ok(!command.includes('Accept-Encoding'));
  // the other header is untouched
  assert.ok(command.includes("-H 'Accept: */*'"));
});

test('toCurl: includeCompressed with no Accept-Encoding adds no --compressed', () => {
  const req = { method: 'GET', target: '/', headers: [{ name: 'Accept', value: '*/*' }], bodyKind: 'empty' };
  const { command } = toCurl(req, { includeCompressed: true }, { origin: 'http://localhost:4040' });
  assert.ok(!command.includes('--compressed'));
});

test('toCurl: an absolute-form target keeps its own scheme', () => {
  const req = {
    method: 'GET',
    target: 'http://abs.example/y',
    headers: [
      { name: 'Host', value: 'h.ngrok.io' },
      { name: 'X-Forwarded-Proto', value: 'https' },
    ],
    bodyKind: 'empty',
  };
  const { command } = toCurl(req, {}, { origin: 'http://localhost:4040' });
  assert.ok(command.includes("'http://abs.example/y'"));
});
