/* ngrok-inspect-plus — curl generation. PURE logic: no DOM, no chrome.*, unit-testable.
 *
 * Dual-consumable:
 *   - browser/content-script (classic script)  -> globalThis.ngpp.curl
 *   - Node (`node --test`)                     -> module.exports
 * This avoids a bundler while keeping the one module with real logic testable.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) (root.ngpp = root.ngpp || {}).curl = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** POSIX single-quote quoting. Inside single quotes everything is literal except '. */
  function sh(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  // Injected by ngrok, not sent by the original client (plan R3).
  const FORWARDED = new Set([
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-real-ip',
  ]);

  const REQUEST_LINE = /^(\S+)\s+(\S+)\s+HTTP\/(\d\.\d)$/;

  /**
   * Parse a raw HTTP request (request line + headers + optional body).
   * @param {string|Uint8Array} input
   * @returns {{method:string,target:string,version:string,headers:{name:string,value:string}[],body:string}|null}
   */
  function parseRawRequest(input) {
    const raw =
      typeof input === 'string'
        ? input
        : new TextDecoder('utf-8', { fatal: false }).decode(input);

    // Preserve the body bytes exactly: prefer the canonical CRLFCRLF separator.
    let sep = raw.indexOf('\r\n\r\n');
    let head, body;
    if (sep !== -1) {
      head = raw.slice(0, sep);
      body = raw.slice(sep + 4);
    } else {
      sep = raw.indexOf('\n\n');
      if (sep === -1) {
        head = raw;
        body = '';
      } else {
        head = raw.slice(0, sep);
        body = raw.slice(sep + 2);
      }
    }

    const lines = head.split(/\r?\n/).filter((l) => l.length > 0);
    const m = lines.length ? REQUEST_LINE.exec(lines[0]) : null;
    if (!m) return null; // not a parseable request line

    const headers = [];
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      if (i === -1) continue; // malformed / obs-fold -> skip
      headers.push({ name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() });
    }
    return { method: m[1], target: m[2], version: m[3], headers, body };
  }

  /** Absolute-form target wins; else Host header; else the page origin (plan R1). */
  function buildUrl(target, headers, scheme, origin) {
    if (/^https?:\/\//i.test(target)) return target;
    const host = headers.find((h) => h.name.toLowerCase() === 'host');
    if (host && host.value) return `${scheme}://${host.value}${target}`;
    return `${origin || ''}${target}`;
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

  function toBase64(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bytes).toString('base64'); // Node fallback
  }

  /**
   * Build a curl command.
   * @param {{method:string,target:string,headers:{name:string,value:string}[],body?:string,
   *          bodyKind?:'text'|'binary'|'unavailable'|'empty',bodyBytes?:Uint8Array,byteLength?:number}} req
   * @param {object} [settings]
   * @param {{origin?:string}} [ctx]
   * @returns {{command:string, warnings:string[]}}
   */
  function toCurl(req, settings, ctx) {
    const s = Object.assign(
      {
        multiline: true,
        stripForwardedHeaders: true,
        includeCompressed: false,
        scheme: 'https',
        binaryBody: 'comment', // comment | escaped | base64
      },
      settings || {}
    );
    const origin = (ctx && ctx.origin) || '';
    const warnings = [];
    const args = [];

    args.push(`-X ${req.method}`);
    args.push(sh(buildUrl(req.target, req.headers, s.scheme, origin)));

    let hasAcceptEncoding = false;
    for (const h of req.headers) {
      const lower = h.name.toLowerCase();
      if (lower === 'host' || lower === 'content-length') continue;
      if (s.stripForwardedHeaders && FORWARDED.has(lower)) continue;
      if (s.includeCompressed && lower === 'accept-encoding') {
        hasAcceptEncoding = true;
        continue;
      }
      if (h.value === '') {
        args.push(`-H ${sh(h.name + ';')}`); // empty value: `Name;` (plan R3)
        continue;
      }
      args.push(`-H ${sh(`${h.name}: ${h.value}`)}`);
    }
    if (hasAcceptEncoding) args.push('--compressed');

    const bodyKind = req.bodyKind || (req.body ? 'text' : 'empty');
    if (bodyKind === 'text' && req.body) {
      args.push(`--data-raw ${sh(req.body)}`); // literal, unlike --data (plan R4)
    } else if (bodyKind === 'binary') {
      const n = req.byteLength != null ? req.byteLength : req.bodyBytes ? req.bodyBytes.length : 0;
      if (s.binaryBody === 'escaped' && req.bodyBytes) {
        args.push(`--data-binary ${ansiC(req.bodyBytes)}`);
      } else if (s.binaryBody === 'base64' && req.bodyBytes) {
        args.push(`--data-binary ${sh(toBase64(req.bodyBytes))}`);
      } else {
        warnings.push(`body omitted: ${n} bytes, non-UTF-8`);
      }
    } else if (bodyKind === 'unavailable') {
      warnings.push(
        req.byteLength != null
          ? `body not captured by ngrok (${req.byteLength} bytes) — headers only`
          : 'body not captured by ngrok — headers only'
      );
    }
    // empty -> emit no body flag at all (plan R4)

    return { command: format(args, s.multiline, warnings), warnings };
  }

  function format(args, multiline, warnings) {
    // R6: the opening line carries the method AND the URL; every -H / body flag
    // goes on its own continuation line.
    const first = args.slice(0, 2).join(' ');
    const rest = args.slice(2);
    let cmd;
    if (multiline && rest.length) {
      cmd = `curl ${first} \\\n  ` + rest.join(' \\\n  ');
    } else {
      cmd = `curl ${args.join(' ')}`;
    }
    if (warnings.length) {
      cmd = warnings.map((w) => `# ngrok-inspect-plus: ${w}`).join('\n') + '\n' + cmd;
    }
    return cmd;
  }

  return { sh, parseRawRequest, toCurl, ansiC, toBase64, buildUrl };
});
