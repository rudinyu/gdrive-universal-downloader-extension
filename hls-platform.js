// Browser-specific HLS APIs stay behind this adapter. Both browsers keep a
// transfer alive in its own extension tab; storage uses the shared IndexedDB layer.
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GUDHlsPlatform = api.createCurrentAdapter(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const makeAdapter = (kind, extensionApi, environment = {}) => {
    const fetchImpl = environment.fetchImpl || root.fetch?.bind(root);
    const storage = environment.storage || root.GUDHlsStorage;
    const eventTarget = environment.eventTarget || root;
    const getExtensionUrl = path => extensionApi.runtime.getURL(path);
    const rulesApi = extensionApi.declarativeNetRequest;
    const downloadsApi = extensionApi.downloads;
    const tabsApi = extensionApi.tabs;
    const permissionsApi = extensionApi.permissions;

    return {
      kind,
      lifecycle: {
        kind: 'extension-tab',
        onPageClose(handler) {
          eventTarget.addEventListener?.('pagehide', handler, { once: true });
        },
      },
      storage,
      network: {
        fetch(url, options) {
          if (typeof fetchImpl !== 'function') throw new Error('Extension fetch is unavailable.');
          return fetchImpl(url, options);
        },
      },
      permissions: {
        async ensureHostAccess(url) {
          if (typeof permissionsApi?.contains !== 'function') return true;
          let originPattern;
          try { originPattern = `${new URL(url).origin}/*`; }
          catch { throw Object.assign(new Error('The media host URL is invalid.'), { code: 'HLS_PERMISSION' }); }
          try {
            const granted = await permissionsApi.contains({ origins: [originPattern] });
            if (!granted) throw Object.assign(new Error('Extension host access is not granted for this media host.'), { code: 'HLS_PERMISSION' });
          } catch (error) {
            if (error?.code === 'HLS_PERMISSION') throw error;
            // The manifest declares <all_urls>; a permissions API diagnostic
            // failure must not override the browser's actual fetch decision.
          }
          return true;
        },
      },
      tabs: {
        async getCurrentId() {
          const tab = await tabsApi.getCurrent();
          return Number.isInteger(tab?.id) ? tab.id : null;
        },
        createExtensionPage(path) {
          return tabsApi.create({ url: getExtensionUrl(path) });
        },
      },
      downloads: {
        download(options) { return downloadsApi.download(options); },
        search(query) { return downloadsApi.search(query); },
        cancel(id) { return downloadsApi.cancel(id); },
        onChanged: {
          addListener(listener) { downloadsApi.onChanged.addListener(listener); },
          removeListener(listener) { downloadsApi.onChanged.removeListener(listener); },
        },
      },
      rules: {
        get available() { return typeof rulesApi?.updateSessionRules === 'function'; },
        getSessionRules() { return rulesApi.getSessionRules(); },
        addSessionRules(rules) { return rulesApi.updateSessionRules({ addRules: rules }); },
        removeSessionRules(ids) { return rulesApi.updateSessionRules({ removeRuleIds: ids }); },
      },
    };
  };

  const createChromeAdapter = (chromeApi, environment = {}) => makeAdapter('chrome-mv3', chromeApi, environment);
  const createFirefoxAdapter = (browserApi, environment = {}) => makeAdapter('firefox-webextension-mv3', browserApi, environment);

  const createCurrentAdapter = environment => {
    if (environment?.browser?.runtime?.id) return createFirefoxAdapter(environment.browser, { eventTarget: environment });
    if (environment?.chrome?.runtime?.id) return createChromeAdapter(environment.chrome, { eventTarget: environment });
    return null;
  };

  return { createChromeAdapter, createFirefoxAdapter, createCurrentAdapter };
});
