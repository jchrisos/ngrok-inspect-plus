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

function loadSelectors(doc, consoleStub = console) {
  const sandbox = { document: doc, console: consoleStub };
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

// B2 regression: the request list is empty and the detail panel absent whenever nothing is
// selected — a normal state. The shape gate must only require the stable shell and must not
// emit a misleading "DOM changed" warning for it (nor repeatedly).
const shellOnly = (sel) => (sel === '#app' || sel === 'nav.navbar' ? {} : null);

test('assertDashboardShape: shell present with nothing selected -> true, no warning', () => {
  const warnings = [];
  const ngpp = loadSelectors(
    { body: { id: 'ngrok' }, querySelector: shellOnly },
    { warn: (...a) => warnings.push(a.join(' ')) }
  );
  assert.equal(ngpp.assertDashboardShape(), true);
  assert.equal(warnings.length, 0);
});

test('assertDashboardShape: a missing shell warns exactly once across repeated calls', () => {
  const warnings = [];
  const ngpp = loadSelectors(
    { body: { id: 'ngrok' }, querySelector: () => null },
    { warn: (...a) => warnings.push(a.join(' ')) }
  );
  assert.equal(ngpp.assertDashboardShape(), false);
  assert.equal(ngpp.assertDashboardShape(), false);
  assert.equal(warnings.length, 1);
});
