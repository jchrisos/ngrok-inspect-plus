/* ngrok-inspect-plus — Feature 4: copy the response body.
 * The response section has no toolbar of its own (verified: the single .pull-right is
 * on the request side), so we create one.
 *
 * Per user request this is a SINGLE action with no dropdown: it always copies ngrok's
 * own Summary rendering of the body (the "summary value"), falling back to the raw body
 * when the Summary pane has nothing. Binary bodies are IGNORED entirely — nothing is
 * written to the clipboard (no placeholder, no base64/escape). */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  /** ngrok's own reformatted body (Summary pane), or null. */
  function readSummaryBody() {
    for (const h6 of document.querySelectorAll(ngpp.SEL.respSummaryHeading)) {
      if (!/^\s*[\d,]+\s+bytes/.test(h6.textContent)) continue;
      const code = h6.parentElement?.querySelector('pre > code');
      if (code?.textContent) return code.textContent;
    }
    return null;
  }

  /** The states of §6.4, computed from the live DOM. */
  function currentState() {
    const read = ngpp.readRawResponse();
    if (read.kind === 'unavailable') return { state: 'not-captured', read };

    const bodyBytes = read.kind === 'bytes' ? ngpp.responseBody.splitBodyBytes(read.bytes) : null;
    // `Content-Length` is a BYTE count, but a JS string's `.length` is UTF-16 code units —
    // so any non-ASCII body (accents, emoji, UTF-8 JSON/HTML) would look shorter than declared
    // and be falsely reported as truncated. Measure bytes on the text path too.
    const byteLength = bodyBytes
      ? bodyBytes.length
      : new TextEncoder().encode(ngpp.responseBody.splitRawResponse(read.text).body).length;
    if (byteLength === 0) return { state: 'empty', read, byteLength };

    // A binary body is ignored outright — checked before truncation so it never copies.
    if (bodyBytes) {
      const charset = ngpp.dom.declaredCharset(ngpp.SEL.respHeaderRow);
      const cls = ngpp.responseBody.classifyBody({ kind: 'bytes', bytes: bodyBytes, charset });
      if (cls.class === 'binary') return { state: 'binary', read, byteLength };
    }

    const declared = ngpp.dom.contentLength(ngpp.SEL.respHeaderRow);
    if (declared != null && byteLength < declared) {
      return { state: 'truncated', read, byteLength, declared };
    }
    return { state: 'available', read, byteLength };
  }

  const REASON = {
    empty: 'no response body',
    'not-captured': 'response body not captured by ngrok',
    binary: 'binary response body — not copied',
  };

  function ensure() {
    const pane = document.querySelector(ngpp.SEL.respSection);
    const inspector = pane && pane.closest(ngpp.SEL.respInspector);
    if (!inspector) return; // no request selected, or DOM drifted -> no-op

    let bar = inspector.querySelector('[data-ngpp="resp-toolbar"]');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'pull-right';
      bar.dataset.ngpp = 'resp-toolbar';

      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'btn btn-primary ngpp-toolbar-btn';
      body.dataset.ngpp = 'copy-response';
      body.textContent = 'Copy body';
      body.setAttribute('aria-label', 'Copy response body');
      bar.appendChild(body);

      inspector.prepend(bar); // before the tab list, matching the request side
    }

    syncState(bar);
  }

  /** Reflect availability on the button without the non-focusable `disabled` attribute. */
  function syncState(bar) {
    const body = bar.querySelector('[data-ngpp="copy-response"]');
    if (!body) return;
    const { state } = currentState();
    const reason = REASON[state];

    if (reason) {
      body.setAttribute('aria-disabled', 'true');
      body.setAttribute('title', reason);
    } else {
      body.removeAttribute('aria-disabled');
      if (state === 'truncated') body.setAttribute('title', 'body appears truncated by ngrok');
      else body.removeAttribute('title');
    }
  }

  async function copyBody() {
    const settings = await ngpp.settings.get();
    const rb = settings.responseBody;
    const { state, read, byteLength, declared } = currentState();

    if (state === 'not-captured' || state === 'empty' || state === 'binary') {
      ngpp.toast.show(REASON[state], 'error');
      return;
    }

    let text;
    let warning = null;

    if (read.kind === 'text') {
      const split = ngpp.responseBody.splitRawResponse(read.text);
      // Always the Summary rendering; raw body only if the Summary pane has none.
      text = readSummaryBody() ?? split.body;
    } else {
      // Binary was filtered out in currentState(), so the bytes decode to text here.
      const bytes = ngpp.responseBody.splitBodyBytes(read.bytes);
      const charset = ngpp.dom.declaredCharset(ngpp.SEL.respHeaderRow);
      const cls = ngpp.responseBody.classifyBody({ kind: 'bytes', bytes, charset });
      text = readSummaryBody() ?? cls.text;
    }
    if (rb.normaliseNewlines) text = text.replace(/\r\n/g, '\n');
    if (state === 'truncated') warning = `copied ${byteLength} of ${declared} bytes (truncated by ngrok)`;

    const res = await ngpp.copyText(text);
    if (!res.ok) {
      ngpp.toast.show('Copy failed', 'error');
      return;
    }
    // Never echo the payload into the toast — announce size only (§6.8).
    const size = read.kind === 'text' ? `${text.length} chars` : `${byteLength} bytes`;
    ngpp.toast.show(warning ? `Copied response body — ${warning}` : `Copied response body (${size})`);
  }

  function mount() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-ngpp="copy-response"]')) copyBody();
    });
  }

  ngpp.features = ngpp.features || {};
  ngpp.features.copyResponse = { id: 'copy-response', ensure, mount };
})(globalThis);
