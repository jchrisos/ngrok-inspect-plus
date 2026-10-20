/* ngrok-inspect-plus — content-script bootstrap. Runs at document_idle (all modules loaded). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  async function boot() {
    // The content scripts match every loopback port, so they run on unrelated localhost
    // apps too. Bail out silently unless this is actually the ngrok dashboard.
    if (!ngpp.isDashboard()) return;

    await ngpp.settings.get(); // prime the cache
    ngpp.toast.init();
    ngpp.theme.init();

    const features = [
      ngpp.features.copyCurl,
      ngpp.features.copyHeaderReq,
      ngpp.features.copyHeaderResp,
      ngpp.features.copyResponse,
    ].filter(Boolean);

    // A feature file that failed to load (manifest typo, syntax error, stale extension
    // load) would otherwise vanish silently — surface it instead of a half-working bundle.
    const missing = ['copyCurl', 'copyHeaderReq', 'copyHeaderResp', 'copyResponse'].filter(
      (k) => !ngpp.features[k]
    );
    if (missing.length) console.warn('[ngrok-inspect-plus] features failed to load:', missing.join(', '));

    ngpp.observer.start(features);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis);
