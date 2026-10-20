#!/usr/bin/env node
/* ngrok-inspect-plus — end-to-end smoke test.
 *
 * Dependency-free: drives a real Chrome over the DevTools Protocol using Node's built-in
 * WebSocket and fetch (Node >= 22). No Puppeteer install, no npm dependencies — consistent with
 * the repo's no-build ethos.
 *
 * It serves a SYNTHETIC ngrok dashboard shell (tests/e2e/dashboard-shell.html) and asserts the
 * injected UI and the exact clipboard payloads. The real agent dashboard is covered by the
 * manual matrix (docs/specs/manual-test-matrix.md); this catches the regressions a unit test
 * cannot — selector drift, injection, the isDashboard() gate, and the copy handlers.
 *
 * Two modes, auto-detected:
 *   extension — Chrome loaded the unpacked extension via --load-extension (the full path).
 *   inject    — Chrome IGNORED --load-extension (see AGENTS.md: Chrome 155 here does), so the
 *               content scripts listed in manifest.json are injected with
 *               Page.addScriptToEvaluateOnNewDocument. Everything except manifest-based
 *               registration is still exercised; the mode is printed prominently.
 *
 * Usage:
 *   node tests/e2e/run.mjs [--headful] [--strict] [--no-extension] [--keep-open]
 *     --headful       show the browser window (default: --headless=new)
 *     --strict        exit non-zero if the extension could not be loaded (use in CI)
 *     --no-extension  skip --load-extension entirely (force inject mode)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const argv = process.argv.slice(2);
const HEADFUL = argv.includes('--headful');
const STRICT = argv.includes('--strict');
const NO_EXTENSION = argv.includes('--no-extension');
const KEEP_OPEN = argv.includes('--keep-open');

const CHROME =
  process.env.CHROME_PATH ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/* ---------- minimal CDP client ---------- */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id != null && this.pending.has(m.id)) {
          const { resolve: res, reject: rej } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) rej(new Error(`${m.error.message} (code ${m.error.code})`));
          else res(m.result);
          return;
        }
        const hs = this.handlers.get(m.method);
        if (hs) for (const h of hs) h(m.params);
      };
      ws.onerror = () => reject(new Error(`CDP socket error at ${this.wsUrl}`));
      ws.onopen = () => resolve();
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, cb) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(cb);
    return () => this.handlers.get(method).splice(this.handlers.get(method).indexOf(cb), 1);
  }
  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (p) => {
        off();
        clearTimeout(t);
        resolve(p);
      });
      const t = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
    });
  }
  /** Evaluate in the page, by value. `gesture: true` supplies transient activation (clicks). */
  async eval(expression, { gesture = false } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: gesture,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`
      );
    }
    return r.result.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`devtools endpoint never came up: ${url}`);
}

/* ---------- assertions ---------- */
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });
const note = (name, detail) => results.push({ name, ok: null, detail });

function report() {
  const failed = results.filter((r) => r.ok === false);
  for (const r of results) {
    const mark = r.ok === null ? '•' : r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  }
  console.log('');
  const passed = results.filter((r) => r.ok === true).length;
  console.log(`${passed} passed, ${failed.length} failed`);
  return failed.length === 0;
}

/* ---------- fixture server ---------- */
function startFixtureServer(port) {
  const page = (file) => readFileSync(join(HERE, file));
  const files = {
    '/dashboard-shell.html': page('dashboard-shell.html'),
    '/plain.html': page('plain.html'),
  };
  const srv = createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    const body = files[path];
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}

/* ---------- main ---------- */
let chrome;
let cdp;
let browser;
let server;
let profileDir;

async function main() {
  if (!CHROME) throw new Error('no Chrome/Chromium found; set CHROME_PATH');
  const httpPort = await freePort();
  const debugPort = await freePort();
  profileDir = mkdtempSync(join(tmpdir(), 'ngpp-e2e-'));
  server = await startFixtureServer(httpPort);
  const origin = `http://127.0.0.1:${httpPort}`;
  // localhost and 127.0.0.1 are the same loopback; use 127.0.0.1 so the match patterns hold.
  const matches = ['http://localhost/*', 'http://127.0.0.1/*'];

  const args = [
    `--user-data-dir=${join(profileDir, 'profile')}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--enable-unsafe-extension-debugging',
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
  ];
  if (!HEADFUL) args.push('--headless=new');
  if (!NO_EXTENSION) args.push(`--load-extension=${ROOT}`);
  args.push('about:blank');

  chrome = spawn(CHROME, args, { stdio: 'ignore', detached: false });

  const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
  browser = new Cdp(version.webSocketDebuggerUrl);
  await browser.open();

  // Did --load-extension actually take? Our unpacked extension runs a service worker; built-in
  // component extensions are `background_page`, so a `service_worker` target is the tell.
  const { targetInfos } = await browser.send('Target.getTargets');
  const swTargets = targetInfos.filter(
    (t) => t.type === 'service_worker' && (t.url || '').startsWith('chrome-extension://')
  );
  const mode = swTargets.length ? 'extension' : 'inject';

  console.log(`\nngrok-inspect-plus e2e — Chrome ${version.Browser}`);
  console.log(`fixture: ${origin}/dashboard-shell.html`);
  if (mode === 'extension') {
    console.log('MODE: extension  (--load-extension honoured; full path incl. manifest registration)');
  } else {
    console.log('MODE: inject  (--load-extension IGNORED by this Chrome — content scripts injected');
    console.log('              via Page.addScriptToEvaluateOnNewDocument; manifest registration NOT');
    console.log('              exercised. See AGENTS.md. Use --strict to fail instead.)');
  }
  console.log('');

  if (STRICT && mode !== 'extension') {
    console.error('--strict: the extension could not be loaded; cannot run the full path.');
    return 1;
  }

  // Connect to the page target directly (simplest: no flattened sessions).
  const pages = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
  const pageTarget = pages.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('no page target');
  cdp = new Cdp(pageTarget.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.bringToFront');

  // Clipboard: loopback is a secure context and clipboard-write is granted by default, but an
  // automated read needs the permission granted explicitly.
  await browser.send('Browser.grantPermissions', {
    origin,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  });

  if (mode === 'inject') {
    await installInjectScripts();
  }

  const setScheme = (value) =>
    cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value }],
    });

  const goto = async (url) => {
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(250); // let the rAF-coalesced observer pass run
  };

  const waitFor = async (expr, timeoutMs = 4000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cdp.eval(expr)) return true;
      await sleep(50);
    }
    return false;
  };

  const readClipboard = () => cdp.eval('navigator.clipboard.readText()');
  const toastText = () => cdp.eval(`(document.querySelector('.ngpp-toast--show')||{}).textContent || null`);
  const click = (selector) =>
    cdp.eval(
      `(() => { const b = document.querySelector(${JSON.stringify(selector)});
        if (!b) return 'MISSING'; b.click(); return 'ok'; })()`,
      { gesture: true }
    );

  /* ---- 1. dark mode (prefers-color-scheme emulated, so it is mode- and OS-independent) ---- */
  await setScheme('dark');
  await goto(`${origin}/dashboard-shell.html`);
  check(
    'dark mode: html.ngpp-dark is set when prefers-color-scheme is dark (themeMode=auto)',
    await cdp.eval(`document.documentElement.classList.contains('ngpp-dark')`)
  );

  /* ---- 2. injection on the dashboard shell ---- */
  check(
    'copy-as-cURL button injected into the toolbar',
    (await waitFor(`!!document.querySelector('[data-ngpp="copy-curl"]')`)) &&
      (await cdp.eval(
        `document.querySelector('[data-ngpp="copy-curl"]').parentElement.querySelector('#replay') !== null`
      )),
    'must sit in #replay\'s parent, before the Replay group'
  );
  check(
    'per-header copy button injected in every request header row',
    (await cdp.eval(
      `document.querySelectorAll('[data-ngpp="copy-header"][data-ngpp-scope="copy-header-req"]').length`
    )) === 5
  );
  check(
    'per-header copy button injected in every response header row',
    (await cdp.eval(
      `document.querySelectorAll('[data-ngpp="copy-header"][data-ngpp-scope="copy-header-resp"]').length`
    )) === 2
  );
  check(
    'response-body button injected with a response toolbar, enabled for a captured body',
    (await cdp.eval(
      `!!document.querySelector('[data-ngpp="resp-toolbar"] [data-ngpp="copy-response"]')`
    )) &&
      (await cdp.eval(
        `document.querySelector('[data-ngpp="copy-response"]').getAttribute('aria-disabled') === null`
      ))
  );
  check(
    'header buttons carry an accessible name refreshed from the live row',
    (await cdp.eval(
      `document.querySelector('#request-pane-1 tbody tr th').closest('tr').querySelector('[data-ngpp="copy-header"]').getAttribute('aria-label')`
    )) === 'Copy header Host'
  );

  /* ---- 3. idempotency: DOM churn must not duplicate the injected UI ---- */
  await cdp.eval(
    `(() => { const app = document.querySelector('#app');
       const probe = document.createElement('div'); app.appendChild(probe); probe.remove(); })()`
  );
  await sleep(250);
  check(
    'injection is idempotent across an observer re-run (no duplicate buttons)',
    (await cdp.eval(`document.querySelectorAll('[data-ngpp="copy-curl"]').length`)) === 1 &&
      (await cdp.eval(`document.querySelectorAll('[data-ngpp="copy-header"]').length`)) === 7 &&
      (await cdp.eval(`document.querySelectorAll('[data-ngpp="copy-response"]').length`)) === 1
  );

  /* ---- 4. copy-as-cURL payload ---- */
  check('copy-as-cURL: click handled', (await click('[data-ngpp="copy-curl"]')) === 'ok');
  await sleep(150);
  const curl = await readClipboard();
  check(
    "copy-as-cURL: scheme comes from X-Forwarded-Proto, URL from the Host header",
    curl.startsWith(`curl -X POST 'https://test-extension.sa.ngrok.io/hello?x=1' \\\n  `),
    JSON.stringify(curl)
  );
  check(
    'copy-as-cURL: original headers kept, ngrok-injected X-Forwarded-* stripped',
    curl.includes(`-H 'X-Custom-Header: abc123'`) &&
      curl.includes(`-H 'Content-Type: application/json'`) &&
      !/x-forwarded|content-length/i.test(curl),
    JSON.stringify(curl)
  );
  check(
    'copy-as-cURL: request body reproduced with --data-raw',
    curl.includes(`--data-raw '{"name":"julio","n":2}'`),
    JSON.stringify(curl)
  );
  check('copy-as-cURL: confirmation toast', (await toastText()) === 'Copied as cURL');

  /* ---- 5. per-header copy is VALUE ONLY ---- */
  const clickHeader = (scope, name) =>
    cdp.eval(
      `(() => {
         for (const row of document.querySelectorAll('tr')) {
           const th = row.querySelector('th');
           if (th && th.textContent.trim() === ${JSON.stringify(name)}) {
             const btn = row.querySelector('[data-ngpp="copy-header"][data-ngpp-scope="' + ${JSON.stringify(scope)} + '"]');
             if (btn) { btn.click(); return 'ok'; }
           }
         }
         return 'MISSING';
       })()`,
      { gesture: true }
    );

  check('header copy (request): click handled', (await clickHeader('copy-header-req', 'X-Custom-Header')) === 'ok');
  await sleep(150);
  check(
    'header copy (request): copies the VALUE only, not "Name: value"',
    (await readClipboard()) === 'abc123',
    JSON.stringify(await readClipboard())
  );
  check(
    'header copy (request): explicit confirmation toast',
    (await toastText()) === 'Copied header X-Custom-Header value.'
  );

  check('header copy (response): click handled', (await clickHeader('copy-header-resp', 'Content-Type')) === 'ok');
  await sleep(150);
  check(
    'header copy (response): copies the VALUE only',
    (await readClipboard()) === 'application/json',
    JSON.stringify(await readClipboard())
  );
  check(
    'header copy (response): explicit confirmation toast',
    (await toastText()) === 'Copied response header Content-Type value.'
  );

  /* ---- 6. response body copy ---- */
  check('copy response body: click handled', (await click('[data-ngpp="copy-response"]')) === 'ok');
  await sleep(150);
  check(
    "copy response body: copies ngrok's Summary rendering",
    (await readClipboard()) === '{"ok":true}',
    JSON.stringify(await readClipboard())
  );
  check(
    'copy response body: announces size only (never echoes the payload)',
    (await toastText()) === 'Copied response body (11 chars)',
    JSON.stringify(await toastText())
  );

  /* ---- 7. the isDashboard() gate keeps the bundle out of unrelated localhost apps ---- */
  await goto(`${origin}/plain.html`);
  await sleep(250);
  check(
    'gate: nothing injected on an unrelated localhost app',
    (await cdp.eval(`document.querySelectorAll('[data-ngpp]').length`)) === 0
  );
  check(
    'gate: no theme class forced on an unrelated localhost app',
    (await cdp.eval(`!document.documentElement.classList.contains('ngpp-dark')`))
  );

  /* ---- 8. light scheme ---- */
  await setScheme('light');
  await goto(`${origin}/dashboard-shell.html`);
  check(
    'dark mode: html.ngpp-dark is absent when prefers-color-scheme is light',
    !(await cdp.eval(`document.documentElement.classList.contains('ngpp-dark')`))
  );

  /* ---- 9. bfcache: no unload handlers / sockets in our code must not block it ---- */
  await setScheme('dark');
  await goto(`${origin}/dashboard-shell.html`);
  await goto(`${origin}/plain.html`);
  await cdp.eval('history.back()');
  await sleep(600);
  const nav = await cdp.eval(
    `(() => {
       const e = performance.getEntriesByType('navigation')[0] || {};
       // NotRestoredReasonDetails exposes "reason" on a prototype, so a plain return-by-value
       // serialises it as {}. Walk the prototype chain and read each name explicitly.
       const dump = (r) => {
         const o = {};
         for (let p = r; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
           for (const k of Object.getOwnPropertyNames(p)) {
             if (k === 'constructor') continue;
             try { o[k] = String(r[k]); } catch { /* ignore */ }
           }
         }
         return o;
       };
       const rs = (e.notRestoredReasons && e.notRestoredReasons.reasons) || [];
       return { url: location.pathname, type: e.type || null,
                reasons: e.notRestoredReasons ? rs.map(dump) : null };
     })()`
  );
  check(
    'bfcache: back/forward navigation is not blocked by the extension',
    nav.reasons === null || (nav.reasons || []).length === 0,
    `url=${nav.url} type=${nav.type} reasons=${JSON.stringify(nav.reasons)}`
  );
  // A bfcache restore reuses the original document, so there is no new navigation entry
  // (`type` stays `navigate`). A blocked navigation shows up as `back_forward` WITH reasons.
  note(
    nav.type === 'navigate'
      ? 'bfcache: the back navigation was served from the cache (no new navigation entry)'
      : 'bfcache: the page was re-loaded rather than restored — check the reasons above',
    `type=${nav.type}`
  );
  check(
    'bfcache: injected UI survives the restore (no re-injection needed)',
    nav.url === '/dashboard-shell.html'
      ? await cdp.eval(`!!document.querySelector('[data-ngpp="copy-curl"]')`)
      : true
  );

  return report() ? 0 : 1;
}

/** Inject the manifest's content scripts into the page's main world (inject mode only). */
async function installInjectScripts() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find((c) => Array.isArray(c.js) && c.js.length);
  if (!entry) throw new Error('no js content_scripts entry in manifest.json');

  // The content scripts are classic scripts sharing one global; in the real extension that is
  // an isolated world with chrome.* available. Here we are in the main world, so `chrome` is
  // augmented (never replaced — the page-visible chrome object is mutated in place).
  const shim = `
    (() => {
      const noop = () => {};
      const c = (globalThis.chrome = globalThis.chrome || {});
      c.storage = c.storage || {};
      c.storage.sync = { get: async () => ({}), set: async () => {} };
      c.storage.onChanged = { addListener: noop };
      c.runtime = c.runtime || {};
      c.runtime.onMessage = { addListener: noop };
      globalThis.__ngppE2EInject = true;
    })();
  `;
  const bundle = entry.js
    .map((f) => `\n/* ==== ${f} ==== */\n` + readFileSync(join(ROOT, f), 'utf8'))
    .join('\n;\n');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: shim + bundle });
}

async function cleanup() {
  try {
    cdp?.close();
  } catch {}
  try {
    browser?.close();
  } catch {}
  try {
    server?.close();
  } catch {}
  if (chrome && !KEEP_OPEN) chrome.kill('SIGKILL');
  await sleep(200);
  if (profileDir && !KEEP_OPEN) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {}
  }
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error(`\ne2e harness error: ${err.message}`);
  code = 1;
} finally {
  await cleanup();
}
process.exit(code);
