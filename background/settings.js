/* ngrok-inspect-plus — service-worker settings accessor (ESM, minimal).
 * Kept in sync with content/settings.js defaults; the SW only needs themeMode. */
const KEY = 'settings';
const DEFAULTS = {
  themeMode: 'auto',
  curl: {
    multiline: true,
    stripForwardedHeaders: true,
    includeCompressed: false,
    binaryBody: 'comment',
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

export async function getSettings() {
  const stored = await chrome.storage.sync.get(KEY);
  return merge(DEFAULTS, stored[KEY] || {});
}
