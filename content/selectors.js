/* ngrok-inspect-plus — SINGLE SOURCE OF TRUTH for every DOM selector.
 * Verified against ngrok 3.39.11 (see .okf/concepts and docs/plans).
 * 27 of the dashboard's classes are CSS-module hashes that change per release,
 * so they are matched by attribute-prefix ([class*="_params_"]) and live here. */
(function (root) {
  const ngpp = (root.ngpp = root.ngpp || {});

  ngpp.NGROK_VERSION_VERIFIED = '3.39.11';

  ngpp.SEL = {
    app: '#app',
    navbar: 'nav.navbar',
    connectionStatus: '#connection-status',

    // request list (newest first)
    listRow: 'table[class*="roundTripSelect"] tbody tr',
    listRowSelected: 'table[class*="roundTripSelect"] tbody tr[class*="_selected_"]',

    // detail panel
    panel: 'div[class*="_inspectRoundTrip_"]',
    panelTitle: 'div[class*="_inspectRoundTrip_"] h3.wrapped', // "PUT /edge?a=1"
    toolbarSlot: '#replay', // stable id; inject via .parentElement

    // request side
    reqPane0: '#request-pane-0',
    reqHeaderRow: '#request-pane-1 table tbody tr',
    reqRawCode: '#request-pane-2 pre > code',
    reqRawPlaceholder: '#request-pane-2 .alert',
    reqHexCode: '#request-pane-3 pre > code',

    // response side — same component, same id scheme
    respSection: '#response-pane-0',
    respInspector: 'div[class*="_inspector_"]',
    respHeaderRow: '#response-pane-1 table tbody tr',
    respRawCode: '#response-pane-2 pre > code',
    respRawPlaceholder: '#response-pane-2 .alert',
    respHexCode: '#response-pane-3 pre > code',
    respSummaryBody: '#response-pane-0 pre > code',
    respSummaryHeading: '#response-pane-0 h6', // "1,234 bytes" label above the Summary body
  };

  /** Is this page the ngrok agent dashboard?
   * The content scripts match *every* loopback port, so they are also injected into
   * unrelated localhost apps; this is the cheap, silent gate that keeps them out.
   * It keys off the agent's stable HTML shell (`<body id="ngrok">`, `<meta name="author"
   * content="ngrok">`) — NOT the CSS-module class hashes, which change per release.
   * Verified against ngrok 3.39.11. */
  ngpp.isDashboard = function () {
    return (
      document.body?.id === 'ngrok' ||
      document.querySelector('meta[name="author"][content="ngrok"]') !== null
    );
  };

  let shapeWarned = false;

  /** Logs ONE warning if the dashboard shell moved on. Returns false when it did.
   * The gate covers only the stable shell (`app` + `navbar`): the request list is empty and
   * the detail panel absent whenever nothing is selected — a normal state, not a DOM change.
   * Requiring the panel/toolbar here would fire a misleading warning on every empty dashboard.
   * The per-feature `ensure()` early returns are the correct guards for "nothing selected". */
  ngpp.assertDashboardShape = function () {
    const required = ['app', 'navbar'];
    const missing = required.filter((k) => !document.querySelector(ngpp.SEL[k]));
    if (missing.length) {
      if (!shapeWarned) {
        shapeWarned = true;
        console.warn(
          `[ngrok-inspect-plus] dashboard DOM changed — missing: ${missing.join(', ')}. ` +
            `Verified against ngrok ${ngpp.NGROK_VERSION_VERIFIED}; this build may be newer. ` +
            `Features will no-op.`
        );
      }
      return false;
    }
    return true;
  };

  /** DOM helpers shared by the feature modules. */
  ngpp.dom = {
    /** @returns {{name:string,value:string}[]} one entry per <tr> (duplicates preserved) */
    headerRows(rowsSelector) {
      const out = [];
      for (const row of document.querySelectorAll(rowsSelector)) {
        const name = row.querySelector('th')?.textContent?.trim();
        const td = row.querySelector('td');
        if (!name || !td) continue;
        out.push({ name, value: ngpp.dom.cellValue(td) });
      }
      return out;
    },

    /** td text with our injected nodes stripped (the button lives inside the td). */
    cellValue(td) {
      const clone = td.cloneNode(true);
      clone.querySelectorAll('[data-ngpp]').forEach((n) => n.remove());
      return clone.textContent.trim();
    },

    /** Declared charset from a Content-Type header row, or null.
     * Scans the rows directly so a non-matching row never pays `cellValue`'s clone cost. */
    declaredCharset(rowsSelector) {
      for (const row of document.querySelectorAll(rowsSelector)) {
        const name = row.querySelector('th')?.textContent?.trim().toLowerCase();
        if (name !== 'content-type') continue;
        const td = row.querySelector('td');
        if (!td) continue;
        return /charset=([\w-]+)/i.exec(ngpp.dom.cellValue(td))?.[1]?.toLowerCase() ?? null;
      }
      return null;
    },

    /** Content-Length as a number, or null. Same short-circuit as `declaredCharset`. */
    contentLength(rowsSelector) {
      for (const row of document.querySelectorAll(rowsSelector)) {
        const name = row.querySelector('th')?.textContent?.trim().toLowerCase();
        if (name !== 'content-length') continue;
        const td = row.querySelector('td');
        if (!td) continue;
        const n = parseInt(ngpp.dom.cellValue(td), 10);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    },
  };
})(globalThis);
