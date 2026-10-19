/* ngrok-inspect-plus — live theme class toggle.
 * The class is normally applied synchronously at document_start by a dynamically
 * registered 1-line script (background/service-worker.js). This module handles
 * *live* changes: the popup broadcasts a new mode, and the OS may switch scheme. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  function apply(mode) {
    const on = mode === 'dark' || (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('ngpp-dark', on);
  }

  function init() {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'ngpp:theme') apply(msg.mode);
    });

    // Keep `auto` honest when the OS scheme changes without a reload.
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (ngpp.settings.cached().themeMode !== 'auto') return;
      document.documentElement.classList.toggle('ngpp-dark', e.matches);
    });
  }

  ngpp.theme = { apply, init };
})(globalThis);
