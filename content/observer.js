/* ngrok-inspect-plus — debounced MutationObserver + idempotent ensure() dispatch. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});
  let scheduled = false;
  let features = [];

  function ensureAll() {
    scheduled = false;
    if (!ngpp.assertDashboardShape()) return;
    for (const f of features) {
      try {
        f.ensure(); // MUST be idempotent
      } catch (err) {
        console.warn('[ngrok-inspect-plus] feature failed', f.id, err);
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(ensureAll); // coalesce the ~1 Hz poll
  }

  function start(list) {
    features = list;
    for (const f of features) {
      try {
        f.mount && f.mount();
      } catch (err) {
        console.warn('[ngrok-inspect-plus] mount failed', f.id, err);
      }
    }
    const app = document.querySelector(ngpp.SEL.app) || document.body;
    new MutationObserver(schedule).observe(app, { childList: true, subtree: true, characterData: true });
    ensureAll();
  }

  ngpp.observer = { start, ensureAll };
})(globalThis);
