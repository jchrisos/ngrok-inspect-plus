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

  function toBase64(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bytes).toString('base64');
  }

  function ansiC(bytes) {
    let out = "$'";
    for (const b of bytes) {
      if (b === 0x27) out += "\\'";
      else if (b === 0x5c) out += '\\\\';
      else if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
      else out += '\\x' + b.toString(16).padStart(2, '0');
    }
    return out + "'";
  }

  /**
   * Turn a classified payload into the exact clipboard text (plan §6.5).
   * Byte fidelity by default; transformations are opt-in and never silent.
   * @param {{class:'text'|'binary'|'unavailable', text?:string, bytes?:Uint8Array, byteLength?:number}} payload
   * @param {object} [settings]
   * @returns {{text:string, warning:string|null}}
   */
  function toCopyableBody(payload, settings) {
    const s = Object.assign(
      {
        normaliseNewlines: false,
        binaryFallback: 'comment', // comment | escaped | base64
      },
      settings || {}
    );

    if (payload.class === 'text') {
      let text = payload.text == null ? '' : payload.text;
      if (s.normaliseNewlines) text = text.replace(/\r\n/g, '\n');
      return { text, warning: null };
    }

    const bytes = payload.bytes;
    const n = payload.byteLength != null ? payload.byteLength : bytes ? bytes.length : 0;

    if (payload.class === 'binary') {
      if (s.binaryFallback === 'escaped' && bytes) {
        return { text: ansiC(bytes), warning: `binary body emitted as an ANSI-C escape (${n} bytes)` };
      }
      if (s.binaryFallback === 'base64' && bytes) {
        return { text: toBase64(bytes), warning: `binary body emitted as base64 (${n} bytes)` };
      }
      return { text: `# binary response body, ${n} bytes — not copied`, warning: null };
    }

    return { text: `# response body not captured by ngrok (${n} bytes)`, warning: null };
  }

  return { splitRawResponse, decodeBytes, classifyBody, toCopyableBody, ansiC, toBase64 };
});
