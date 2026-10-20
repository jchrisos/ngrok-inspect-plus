/* ngrok-inspect-plus — response body decoding. PURE logic: no DOM, no chrome.*, unit-testable.
 * Dual-consumable (classic content script + CommonJS) like content/curl.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.ngpp = root.ngpp || {}).responseBody = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Split a raw HTTP response into head + body. Body-only is the default copy target. */
  function splitRawResponse(text) {
    const at = text.indexOf('\r\n\r\n');
    if (at !== -1) return { head: text.slice(0, at), body: text.slice(at + 4) };
    const alt = text.indexOf('\n\n');
    if (alt !== -1) return { head: text.slice(0, alt), body: text.slice(alt + 2) };
    return { head: text, body: '' };
  }

  /**
   * Decode bytes using a declared charset, then UTF-8. fatal:true so genuine binary
   * throws rather than producing mojibake (plan §6.3).
   * @returns {{ok:true,text:string,label:string}|{ok:false,text:null}}
   */
  function decodeBytes(bytes, charset) {
    const labels = [];
    if (charset) labels.push(charset);
    labels.push('utf-8');
    for (const label of labels) {
      try {
        return { ok: true, text: new TextDecoder(label, { fatal: true }).decode(bytes), label };
      } catch (e) {
        // RangeError (unknown label) or TypeError (invalid bytes) -> try the next
      }
    }
    return { ok: false, text: null };
  }

  /**
   * Classify a payload as text / binary / unavailable (plan §6.3).
   * @param {{kind:'text'|'bytes'|'unavailable', text?:string, bytes?:Uint8Array, charset?:string|null}} payload
   */
  function classifyBody(payload) {
    if (payload.kind === 'text') return { class: 'text', text: payload.text };
    if (payload.kind === 'bytes') {
      const dec = decodeBytes(payload.bytes, payload.charset);
      return dec.ok
        ? { class: 'text', text: dec.text }
        : { class: 'binary', bytes: payload.bytes };
    }
    return { class: 'unavailable' };
  }

  return { splitRawResponse, decodeBytes, classifyBody };
});
