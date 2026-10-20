/* ngrok-inspect-plus — Feature 2: copy the raw request as a curl command. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  /** When ngrok did not capture the body, rebuild method/target/headers from the DOM. */
  function readUnavailableRequest() {
    const title = document.querySelector(ngpp.SEL.panelTitle)?.textContent?.trim() || '';
    const m = /^(\S+)\s+(\S+)/.exec(title);
    if (!m) return null;
    return { method: m[1], target: m[2], headers: ngpp.dom.headerRows(ngpp.SEL.reqHeaderRow) };
  }

  function ensure() {
    const slot = document.querySelector(ngpp.SEL.toolbarSlot); // #replay
    const parent = slot && slot.parentElement;
    if (!parent) return;
    if (parent.querySelector('[data-ngpp="copy-curl"]')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary ngpp-toolbar-btn';
    btn.dataset.ngpp = 'copy-curl';
    btn.textContent = 'Copy as cURL';
    btn.setAttribute('aria-label', 'Copy request as cURL');
    parent.insertBefore(btn, slot); // before the Replay group
  }

  async function onClick() {
    const settings = await ngpp.settings.get();
    const read = ngpp.readRawRequest();

    let req = null;
    let bodyKind = 'empty';
    let bodyBytes = null;
    let byteLength = null;

    if (read.kind === 'text') {
      req = ngpp.curl.parseRawRequest(read.text);
      if (req) {
        bodyKind = req.body ? 'text' : 'empty';
        byteLength = req.body.length;
      }
    } else if (read.kind === 'bytes') {
      req = ngpp.curl.parseRawRequest(read.bytes);
      if (req) {
        const bb = ngpp.responseBody.splitBodyBytes(read.bytes);
        byteLength = bb.length;
        if (bb.length === 0) {
          bodyKind = 'empty';
        } else {
          const dec = ngpp.responseBody.decodeBytes(bb, null);
          if (dec.ok) {
            req.body = dec.text;
            bodyKind = 'text';
          } else {
            bodyKind = 'binary';
            bodyBytes = bb;
          }
        }
      }
    } else {
      req = readUnavailableRequest();
      bodyKind = 'unavailable';
    }

    if (!req) {
      ngpp.toast.show('Could not read this request', 'error');
      return;
    }

    const { command, warnings } = ngpp.curl.toCurl(
      { method: req.method, target: req.target, headers: req.headers, body: req.body, bodyKind, bodyBytes, byteLength },
      settings.curl,
      { origin: location.origin }
    );

    const res = await ngpp.copyText(command);
    if (!res.ok) {
      ngpp.toast.show('Copy failed', 'error');
      return;
    }
    ngpp.toast.show(warnings.length ? `Copied as cURL — ${warnings[0]}` : 'Copied as cURL');
  }

  function mount() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-ngpp="copy-curl"]')) return;
      onClick();
    });
  }

  ngpp.features = ngpp.features || {};
  ngpp.features.copyCurl = { id: 'copy-curl', ensure, mount };
})(globalThis);
