/* ngrok-inspect-plus — parameterised raw-message reader (used for BOTH request and response).
 * PURE of chrome.*; touches the DOM only when the returned reader is called.
 * Dual-consumable (classic content script + CommonJS) like content/curl.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.ngpp = root.ngpp || {}).rawMessage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Parse the Binary pane's hex dump back to exact bytes (8 hex pairs/line, TAB, ASCII). */
  function parseHexDump(text) {
    const out = [];
    for (const line of text.split('\n')) {
      const hexCol = line.split('\t')[0];
      for (const tok of hexCol.trim().split(/\s+/)) {
        if (/^[0-9a-f]{2}$/i.test(tok)) out.push(parseInt(tok, 16));
      }
    }
    return Uint8Array.from(out);
  }

  /**
   * @param {{rawCode:string, hexCode:string}} codes
   * @returns {() => {kind:'text'|'bytes'|'unavailable', text?:string, bytes?:Uint8Array, reason?:string}}
   */
  function createMessageReader({ rawCode, hexCode }) {
    return function read() {
      // 1. Preferred: the Raw pane holds the exact message as text.
      const code = document.querySelector(rawCode);
      if (code && code.textContent.trim()) return { kind: 'text', text: code.textContent };

      // 2. Fallback: the Binary pane holds a byte-exact hex dump of the FULL message.
      const hex = document.querySelector(hexCode);
      if (hex && hex.textContent.trim()) {
        const bytes = parseHexDump(hex.textContent);
        if (bytes.length) return { kind: 'bytes', bytes };
      }

      // 3. Degraded: ngrok did not capture the payload.
      return { kind: 'unavailable', reason: 'ngrok did not capture this payload' };
    };
  }

  return { parseHexDump, createMessageReader };
});
