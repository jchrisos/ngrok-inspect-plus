/* ngrok-inspect-plus — settings. Persisted under a single `settings` key in chrome.storage.sync.
 * Shared by the content scripts AND the popup (loaded as a plain script in both),
 * so the defaults live in exactly one place. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});
  const KEY = 'settings';

  const DEFAULTS = {
    themeMode: 'auto', // auto | light | dark
    curl: {
      multiline: true, // false => single-line (Windows cmd.exe)
      stripForwardedHeaders: true, // drop ngrok-injected X-Forwarded-*
      includeCompressed: false, // add --compressed and drop Accept-Encoding
      scheme: 'https', // https | http  (Q2)
      binaryBody: 'comment', // comment | escaped | base64
    },
    responseBody: {
      normaliseNewlines: false,
    },
  };

  function merge(base, patch) {
    const out = Object.assign({}, base);
    for (const k of Object.keys(patch || {})) {
      const v = patch[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] || {}, v) : v;
    }
    return out;
  }

  let cache = null;

  async function get() {
    if (cache) return cache;
    try {
      const stored = await chrome.storage.sync.get(KEY);
      cache = merge(DEFAULTS, stored[KEY] || {});
    } catch (e) {
      cache = merge(DEFAULTS, {});
    }
    return cache;
  }

  function cached() {
    return cache || merge(DEFAULTS, {});
  }

  async function set(patch) {
    const next = merge(await get(), patch);
    cache = next;
    await chrome.storage.sync.set({ [KEY]: next });
    return next;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[KEY]) cache = merge(DEFAULTS, changes[KEY].newValue || {});
  });

  ngpp.settings = { DEFAULTS, KEY, get, set, cached, merge };
})(globalThis);
