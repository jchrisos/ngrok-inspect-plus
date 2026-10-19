/* ngrok-inspect-plus — service worker (ESM). STATELESS: every wake-up re-reads chrome.storage.
 *
 * Its only real job is to own the *dynamic content-script registration* that removes
 * the dark-mode FOUC race: the persisted theme mode IS the registration state, so the
 * class can be applied synchronously at document_start with no async read in the page. */
import { getSettings } from './settings.js';

const SCRIPT_ID = 'ngpp-theme-apply';

/* The pre-paint theme bootstrap is an UNCONDITIONAL `classList.add('ngpp-dark')`, so it is
 * registered for the DEFAULT ngrok origin only: matching all loopback ports would darken
 * every unrelated localhost app. A dashboard on a custom port is still themed, just later —
 * content/theme.js applies the class at document_idle (possible brief flash on load). */
const PREPAINT_MATCHES = ['http://localhost:4040/*', 'http://127.0.0.1:4040/*'];

/* Live theme broadcasts, on the other hand, must reach the dashboard on whatever loopback
 * port it runs — so these cover all ports (no explicit port = any port). */
const LOOPBACK_MATCHES = ['http://localhost/*', 'http://127.0.0.1/*'];

const APPLY = { dark: 'theme/apply-dark.js', auto: 'theme/apply-dark-auto.js' };

async function reconcileThemeRegistration() {
  const { themeMode = 'auto' } = await getSettings();

  const existing = (await chrome.scripting.getRegisteredContentScripts()).find((s) => s.id === SCRIPT_ID);
  if (existing) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });

  const js = APPLY[themeMode];
  if (!js) return; // 'light' -> nothing to register; dark.css stays inert

  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches: PREPAINT_MATCHES, js: [js], runAt: 'document_start', allFrames: false },
  ]);
}

async function broadcastTheme() {
  const { themeMode = 'auto' } = await getSettings();
  const tabs = await chrome.tabs.query({ url: LOOPBACK_MATCHES });
  for (const t of tabs) {
    chrome.tabs.sendMessage(t.id, { type: 'ngpp:theme', mode: themeMode }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(reconcileThemeRegistration);
chrome.runtime.onStartup.addListener(reconcileThemeRegistration);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    reconcileThemeRegistration();
    broadcastTheme();
  }
});
