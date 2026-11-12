const Platform = require('../hls-platform.js');

const makeApi = (extensionScheme = 'moz-extension') => {
  const onChanged = { addListener: jest.fn(), removeListener: jest.fn() };
  return {
    runtime: { id: 'test-extension', getURL: path => `${extensionScheme}://test/${path}` },
    tabs: {
      create: jest.fn(async options => ({ id: 7, ...options })),
      getCurrent: jest.fn(async () => ({ id: 7 })),
    },
    permissions: { contains: jest.fn(async () => true) },
    downloads: {
      download: jest.fn(async options => 12),
      search: jest.fn(async () => [{ id: 12, state: 'complete' }]),
      cancel: jest.fn(async () => {}),
      onChanged,
    },
    declarativeNetRequest: {
      getSessionRules: jest.fn(async () => []),
      updateSessionRules: jest.fn(async () => {}),
    },
  };
};

describe.each([
  ['Chrome MV3', Platform.createChromeAdapter, 'chrome-mv3', 'chrome-extension'],
  ['Firefox WebExtension MV3', Platform.createFirefoxAdapter, 'firefox-webextension-mv3', 'moz-extension'],
])('%s HLS platform adapter', (_label, createAdapter, kind, extensionScheme) => {
  test('routes tabs, networking, storage, permissions, downloads, and session rules through that browser API', async () => {
    const api = makeApi(extensionScheme);
    const fetchImpl = jest.fn(async () => ({ ok: true }));
    const storage = { putJob: jest.fn() };
    const eventTarget = { addEventListener: jest.fn() };
    const adapter = createAdapter(api, { fetchImpl, storage, eventTarget });

    expect(adapter.kind).toBe(kind);
    expect(adapter.lifecycle.kind).toBe('extension-tab');
    expect(adapter.storage).toBe(storage);
    expect(await adapter.tabs.getCurrentId()).toBe(7);
    await adapter.tabs.createExtensionPage('hls.html?job=abc');
    expect(api.tabs.create).toHaveBeenCalledWith({ url: `${extensionScheme}://test/hls.html?job=abc` });
    await adapter.network.fetch('https://cdn.example/media.m3u8');
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example/media.m3u8', undefined);
    await expect(adapter.permissions.ensureHostAccess('https://cdn.example/media.m3u8')).resolves.toBe(true);
    expect(api.permissions.contains).toHaveBeenCalledWith({ origins: ['https://cdn.example/*'] });
    await adapter.downloads.download({ url: 'blob:extension', filename: 'video.mp4' });
    await adapter.downloads.search({ id: 12 });
    await adapter.downloads.cancel(12);
    expect(api.downloads.download).toHaveBeenCalledTimes(1);
    expect(api.downloads.search).toHaveBeenCalledWith({ id: 12 });
    expect(api.downloads.cancel).toHaveBeenCalledWith(12);
    await adapter.rules.addSessionRules([{ id: 123 }]);
    expect(api.declarativeNetRequest.updateSessionRules).toHaveBeenCalledWith({ addRules: [{ id: 123 }] });
    const onClose = jest.fn();
    adapter.lifecycle.onPageClose(onClose);
    expect(eventTarget.addEventListener).toHaveBeenCalledWith('pagehide', onClose, { once: true });
  });

  test('reports missing host access without requesting wider permissions', async () => {
    const api = makeApi(extensionScheme);
    api.permissions.contains.mockResolvedValue(false);
    const adapter = createAdapter(api, { fetchImpl: async () => ({}) });

    await expect(adapter.permissions.ensureHostAccess('https://cdn.example/media.m3u8'))
      .rejects.toMatchObject({ code: 'HLS_PERMISSION' });
    expect(api.permissions.contains).toHaveBeenCalledTimes(1);
  });
});

test('selects the Firefox adapter when the Firefox WebExtension API is present', () => {
  const firefox = makeApi();
  const chrome = makeApi();
  const environment = {
    browser: { ...firefox, runtime: { ...firefox.runtime, id: 'firefox-id' } },
    chrome: { ...chrome, runtime: { ...chrome.runtime, id: 'chrome-id' } },
    addEventListener: jest.fn(),
  };

  expect(Platform.createCurrentAdapter(environment).kind).toBe('firefox-webextension-mv3');
});
