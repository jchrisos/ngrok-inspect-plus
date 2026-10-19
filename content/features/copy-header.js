/* ngrok-inspect-plus — Feature 3: copy a single header row (request AND response).
 * Parameterised by the row selector; the same logic serves both panes. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  // Inline SVG — deliberately not chrome.runtime.getURL(), which would force a
  // web_accessible_resources entry and expose extension internals to the page.
  const COPY_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M5 1h7a2 2 0 0 1 2 2v7h-2V3H5V1zM3 5h7a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm0 2v6h7V7H3z"/>' +
    '</svg>';

  /**
   * @param {{id:string, rowsSelector:string, label:string}} opts
   * @returns {{id:string, ensure:()=>void, mount:()=>void}}
   */
  function makeHeaderCopyFeature({ id, rowsSelector, label }) {
    function ensure() {
      for (const row of document.querySelectorAll(rowsSelector)) {
        const name = row.querySelector('th')?.textContent?.trim();
        const td = row.querySelector('td');
        if (!name || !td) continue;

        let btn = td.querySelector('[data-ngpp="copy-header"]');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.ngpp = 'copy-header';
          btn.dataset.ngppScope = id;
          btn.className = 'ngpp-hdr-copy';
          btn.innerHTML = COPY_ICON_SVG;
          td.appendChild(btn);
        }
        // Heal staleness: React reuses <tr>/<td> nodes across selection changes,
        // so the accessible name must be refreshed on every pass (§5.4).
        const ariaLabel = `Copy ${label} ${name}`;
        if (btn.getAttribute('aria-label') !== ariaLabel) btn.setAttribute('aria-label', ariaLabel);
      }
    }

    function mount() {
      // One delegated listener per feature (never one per button). The payload is
      // resolved from the LIVE DOM at click time, so stale closures are impossible.
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ngpp="copy-header"]');
        if (!btn || btn.dataset.ngppScope !== id) return;
        const row = btn.closest('tr');
        if (!row) return;
        const name = row.querySelector('th')?.textContent?.trim() ?? '';
        const td = row.querySelector('td');
        if (!name || !td) return;
        const value = ngpp.dom.cellValue(td);
        ngpp.copyText(`${name}: ${value}`).then((res) => {
          if (res.ok) ngpp.toast.show(`Copied ${label}: ${name}`);
          else ngpp.toast.show('Copy failed', 'error');
        });
      });
    }

    return { id, ensure, mount };
  }

  ngpp.features = ngpp.features || {};
  ngpp.features.copyHeaderReq = makeHeaderCopyFeature({
    id: 'copy-header-req',
    rowsSelector: ngpp.SEL.reqHeaderRow,
    label: 'header',
  });
  ngpp.features.copyHeaderResp = makeHeaderCopyFeature({
    id: 'copy-header-resp',
    rowsSelector: ngpp.SEL.respHeaderRow,
    label: 'response header',
  });
})(globalThis);
