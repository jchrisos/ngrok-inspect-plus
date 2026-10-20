// ngrok-inspect-plus — copy-response state machine (content/features/copy-response.js).
//
// The feature is a classic content script (an IIFE over globalThis), so it is loaded here in a
// vm sandbox with a stubbed `document` + `ngpp`, and its `ensure()` is driven so the button's
// attributes reveal the computed state.
//
// Regression guard for B1: truncation compares the body against `Content-Length`, which is a
// BYTE count. A JS string's `.length` is UTF-16 code units, so before the fix any non-ASCII
// body looked shorter than declared and was falsely reported as truncated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL('../content/features/copy-response.js', import.meta.url), 'utf8');
const responseBody = require('../content/response-body.js');

const SEL = {
  respSection: '#response-pane-0',
  respInspector: 'div[class*="_inspector_"]',
  respHeaderRow: '#response-pane-1 table tbody tr',
  respSummaryHeading: '#response-pane-0 h6',
};

/** Build a DOM stub whose only job is to survive `ensure()` -> `syncState()`. */
function makeDom() {
  const btn = {
    attrs: {},
    dataset: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
  };
  const bar = { dataset: {}, querySelector: () => btn, appendChild() {} };
  const inspector = { querySelector: (sel) => (sel.includes('resp-toolbar') ? bar : null), prepend() {} };
  const pane = { closest: () => inspector };
  const document = {
    querySelector: (sel) => (sel === SEL.respSection ? pane : null),
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, appendChild() {}, setAttribute() {} }),
    addEventListener() {},
  };
  return { document, btn };
}

function loadFeature({ read, contentLength }) {
  const { document, btn } = makeDom();
  const sandbox = {
    document,
    console,
    TextEncoder,
    ngpp: {
      SEL,
      readRawResponse: () => read,
      responseBody,
      dom: { declaredCharset: () => null, contentLength: () => contentLength },
      settings: { get: async () => ({ responseBody: {} }) },
      toast: { show() {} },
      copyText: async () => ({ ok: true }),
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.ngpp.features.copyResponse.ensure();
  return btn;
}

const rawWith = (body) =>
  `HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.length}\r\n\r\n${body}`;

test('B1: a non-ASCII body with a matching Content-Length is NOT truncated', () => {
  const body = 'café'; // 4 UTF-16 code units, 5 UTF-8 bytes
  const btn = loadFeature({ read: { kind: 'text', text: rawWith(body) }, contentLength: 5 });
  assert.equal(btn.getAttribute('aria-disabled'), null);
  assert.notEqual(btn.getAttribute('title'), 'body appears truncated by ngrok');
});

test('a genuinely short body against a larger Content-Length IS truncated', () => {
  const btn = loadFeature({ read: { kind: 'text', text: rawWith('hello') }, contentLength: 100 });
  assert.equal(btn.getAttribute('aria-disabled'), null);
  assert.equal(btn.getAttribute('title'), 'body appears truncated by ngrok');
});

test('an ASCII body matching Content-Length is available (no title, no aria-disabled)', () => {
  const btn = loadFeature({ read: { kind: 'text', text: rawWith('hello') }, contentLength: 5 });
  assert.equal(btn.getAttribute('aria-disabled'), null);
  assert.equal(btn.getAttribute('title'), null);
});

test('an unavailable payload is marked aria-disabled with the not-captured reason', () => {
  const btn = loadFeature({ read: { kind: 'unavailable' }, contentLength: null });
  assert.equal(btn.getAttribute('aria-disabled'), 'true');
  assert.equal(btn.getAttribute('title'), 'response body not captured by ngrok');
});
