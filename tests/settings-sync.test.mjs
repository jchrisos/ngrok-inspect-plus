// ngrok-inspect-plus — settings drift guard.
//
// `content/settings.js` (classic content script) and `background/settings.js` (ESM service
// worker) hold duplicate DEFAULTS that must stay identical — AGENTS.md says "keep in sync",
// but nothing enforced it. A build step cannot share one file (content scripts cannot be ESM
// and the SW cannot be classic), so this test is the enforcement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const CONTENT_SRC = readFileSync(new URL('../content/settings.js', import.meta.url), 'utf8');
const BG_SRC = readFileSync(new URL('../background/settings.js', import.meta.url), 'utf8');

function contentDefaults() {
  const sandbox = {
    console,
    chrome: {
      storage: {
        sync: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONTENT_SRC, sandbox);
  return sandbox.ngpp.settings.DEFAULTS;
}

async function backgroundDefaults() {
  const dir = mkdtempSync(join(tmpdir(), 'ngpp-settings-'));
  const file = join(dir, 'settings.mjs');
  writeFileSync(file, BG_SRC.replace('const DEFAULTS =', 'export const DEFAULTS ='));
  const mod = await import(pathToFileURL(file).href + '?t=' + Math.random());
  return mod.DEFAULTS;
}

test('content/ and background/ DEFAULTS are identical (no drift)', async () => {
  // JSON round-trip: the content-script DEFAULTS come from a vm realm with a different
  // Object.prototype, which deepStrictEqual would reject on prototype identity alone.
  const content = JSON.parse(JSON.stringify(contentDefaults()));
  assert.deepEqual(content, await backgroundDefaults());
});
