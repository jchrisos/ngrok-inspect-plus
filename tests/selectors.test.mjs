// ngrok-inspect-plus — dashboard detection (content/selectors.js).
//
// selectors.js is a classic content script (an IIFE over globalThis), not a module, so it is
// loaded here in a vm sandbox with a stubbed `document`. The detection gate matters because the
// content scripts now match EVERY loopback port and must stay silent on unrelated localhost apps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../content/selectors.js', import.meta.url), 'utf8');

function loadSelectors(doc) {
  const sandbox = { document: doc, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.ngpp;
}

const noMeta = () => null;

test('isDashboard: true for the agent shell (<body id="ngrok">)', () => {
  const ngpp = loadSelectors({ body: { id: 'ngrok' }, querySelector: noMeta });
  assert.equal(ngpp.isDashboard(), true);
});

test('isDashboard: true from the shell meta alone (author=ngrok)', () => {
  const ngpp = loadSelectors({
    body: { id: 'app' },
    querySelector: (sel) => (sel.includes('meta[name="author"]') ? {} : null),
  });
  assert.equal(ngpp.isDashboard(), true);
});

test('isDashboard: false on an unrelated localhost app', () => {
  const ngpp = loadSelectors({ body: { id: 'app' }, querySelector: noMeta });
  assert.equal(ngpp.isDashboard(), false);
});

test('isDashboard: false before <body> exists', () => {
  const ngpp = loadSelectors({ body: null, querySelector: noMeta });
  assert.equal(ngpp.isDashboard(), false);
});
