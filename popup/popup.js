/* ngrok-inspect-plus — popup. Reuses content/settings.js (loaded first) so defaults live once. */
(function () {
  const { get, set } = globalThis.ngpp.settings;

  const CHECKBOXES = [
    'curl.multiline',
    'curl.stripForwardedHeaders',
    'curl.includeCompressed',
    'responseBody.normaliseNewlines',
  ];

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function patchFor(path, value) {
    const [group, key] = path.split('.');
    return { [group]: { [key]: value } };
  }

  async function render() {
    const s = await get();

    for (const radio of document.querySelectorAll('input[name="themeMode"]')) {
      radio.checked = radio.value === s.themeMode;
    }
    for (const id of CHECKBOXES) document.getElementById(id).checked = Boolean(getPath(s, id));
  }

  function wire() {
    for (const radio of document.querySelectorAll('input[name="themeMode"]')) {
      radio.addEventListener('change', () => {
        if (radio.checked) set({ themeMode: radio.value });
      });
    }
    for (const id of CHECKBOXES) {
      document.getElementById(id).addEventListener('change', (e) => {
        set(patchFor(id, e.target.checked));
      });
    }
  }

  render();
  wire();
})();
