/* ngrok-inspect-plus — clipboard. localhost:4040 is a secure context and clipboard-write is
 * granted by default, so navigator.clipboard needs no permission (plan §4.5). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  /** @returns {Promise<{ok:boolean, legacy?:boolean, error?:string}>} */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text); // our click supplies transient activation
      return { ok: true };
    } catch (err) {
      return legacyCopy(text) ? { ok: true, legacy: true } : { ok: false, error: err?.name ?? 'unknown' };
    }
  }

  /** Fallback for a blurred/older document. execCommand is deprecated but functional. */
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = (() => {
      try {
        return document.execCommand('copy');
      } catch (e) {
        return false;
      }
    })();
    ta.remove();
    return ok;
  }

  ngpp.copyText = copyText;
})(globalThis);
