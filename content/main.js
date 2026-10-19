/* ngrok-inspect-plus — content-script bootstrap. Runs at document_idle (all modules loaded). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  async function boot() {
    await ngpp.settings.get(); // prime the cache
    ngpp.toast.init();
    ngpp.theme.init();

    const features = [
      ngpp.features.copyCurl,
      ngpp.features.copyHeaderReq,
      ngpp.features.copyHeaderResp,
      ngpp.features.copyResponse,
    ].filter(Boolean);

    ngpp.observer.start(features);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis);
