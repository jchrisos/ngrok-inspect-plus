// ngrok-inspect-plus — service-worker registration logic, verified with a mocked chrome API.
//
// Chrome 155 no longer honours --load-extension, so the SW cannot be exercised in a
// real browser here. This test loads the REAL background/service-worker.js (copied to a
// temp .mjs so Node treats it as ESM) against a chrome mock, and asserts the decision
// that underpins the no-FOUC mechanism: which bootstrap script gets registered per mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SW_SRC = readFileSync(new URL('../background/service-worker.js', import.meta.url), 'utf8');
const SETTINGS_SRC = readFileSync(new URL('../background/settings.js', import.meta.url), 'utf8');

function makeChrome(settings) {
  const calls = { registered: [], unregistered: [], messages: [] };
  let registered = [];
  const chrome = {
    storage: {
      sync: { get: async () => ({ settings }) },
      onChanged: { addListener() {} },
    },
    scripting: {
      getRegisteredContentScripts: async () => registered.slice(),
      unregisterContentScripts: async ({ ids }) => {
        calls.unregistered.push(...ids);
        registered = registered.filter((s) => !ids.includes(s.id));
      },
      registerContentScripts: async (scripts) => {
        calls.registered.push(...scripts);
        registered = scripts.slice();
      },
    },
    runtime: {
      onInstalled: { addListener: (fn) => (calls.onInstalled = fn) },
      onStartup: { addListener: (fn) => (calls.onStartup = fn) },
    },
    tabs: {
      query: async () => [{ id: 7 }],
      sendMessage: async (id, msg) => calls.messages.push({ id, msg }),
    },
  };
  return { chrome, calls };
}

async function loadSW(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'ngpp-sw-'));
  writeFileSync(join(dir, 'service-worker.mjs'), SW_SRC.replace('./settings.js', './settings.mjs'));
  writeFileSync(join(dir, 'settings.mjs'), SETTINGS_SRC);
  const { chrome, calls } = makeChrome(settings);
  globalThis.chrome = chrome;
  const mod = await import(pathToFileURL(join(dir, 'service-worker.mjs')).href + '?t=' + Math.random());
  return { mod, calls };
}

test('themeMode "dark" registers apply-dark.js at document_start', async () => {
  const { calls } = await loadSW({ themeMode: 'dark' });
  await calls.onInstalled();
  assert.equal(calls.registered.length, 1);
  assert.deepEqual(calls.registered[0].js, ['theme/apply-dark.js']);
  assert.equal(calls.registered[0].runAt, 'document_start');
  assert.equal(calls.registered[0].id, 'ngpp-theme-apply');
  assert.deepEqual(calls.registered[0].matches, ['http://localhost:4040/*', 'http://127.0.0.1:4040/*']);
  assert.equal(calls.registered[0].allFrames, false);
});

test('themeMode "auto" registers apply-dark-auto.js', async () => {
  const { calls } = await loadSW({ themeMode: 'auto' });
  await calls.onStartup();
  assert.deepEqual(calls.registered[0].js, ['theme/apply-dark-auto.js']);
});

test('themeMode "light" registers nothing (dark.css stays inert)', async () => {
  const { calls } = await loadSW({ themeMode: 'light' });
  await calls.onInstalled();
  assert.equal(calls.registered.length, 0);
});

test('an existing registration is unregistered before re-registering (idempotent)', async () => {
  const { calls } = await loadSW({ themeMode: 'dark' });
  // first reconcile leaves ngpp-theme-apply registered
  await calls.onInstalled();
  // second reconcile must unregister it first, then register again -> exactly one live
  await calls.onInstalled();
  assert.ok(calls.unregistered.includes('ngpp-theme-apply'));
  assert.equal(calls.registered.length, 2);
});

test('settings default to auto when storage is empty', async () => {
  const { calls } = await loadSW(undefined);
  await calls.onInstalled();
  assert.deepEqual(calls.registered[0].js, ['theme/apply-dark-auto.js']);
});
