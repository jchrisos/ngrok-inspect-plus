/* ngrok-inspect-plus — transient, accessible toasts. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});
  let el = null;
  let timer = 0;

  function init() {
    if (el) return;
    el = document.createElement('div');
    el.className = 'ngpp-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.documentElement.appendChild(el);
  }

  /** @param {string} msg @param {'info'|'error'} [kind] */
  function show(msg, kind) {
    init();
    el.textContent = msg;
    el.dataset.kind = kind || 'info';
    el.classList.add('ngpp-toast--show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('ngpp-toast--show'), 2400);
  }

  ngpp.toast = { init, show };
})(globalThis);
