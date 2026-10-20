// ngrok-inspect-plus — manifest invariants.
//
// Guards the "works on any dashboard port" fix: a match pattern with an EXPLICIT port only
// matches that port ("Match patterns match all ports unless an explicit port is specified"),
// so pinning :4040 silently disables the whole extension whenever the ngrok agent serves its
// dashboard elsewhere (e.g. `ngrok http 8080 --web-addr localhost:4041`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const LOOPBACK = ['http://localhost/*', 'http://127.0.0.1/*'];

test('host_permissions cover every loopback port (no pinned :4040)', () => {
  assert.deepEqual(manifest.host_permissions, LOOPBACK);
});

test('every content-script block matches every loopback port', () => {
  assert.ok(manifest.content_scripts.length >= 1);
  for (const cs of manifest.content_scripts) assert.deepEqual(cs.matches, LOOPBACK);
});

test('permissions are exactly the two the extension needs', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'scripting']);
});

test('no web_accessible_resources (inline SVG keeps extension internals unexposed)', () => {
  assert.equal(manifest.web_accessible_resources, undefined);
});

test('manifest version matches package.json', () => {
  assert.equal(manifest.version, pkg.version);
});

test('every declared icon exists on disk', () => {
  for (const p of Object.values(manifest.icons)) {
    assert.ok(existsSync(new URL('../' + p, import.meta.url)), `missing icon: ${p}`);
  }
});

test('description fits the Chrome Web Store limit', () => {
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} chars`);
});
