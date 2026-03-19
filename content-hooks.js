// GDrive Universal Downloader — Early Hook
// Injected at document_start in MAIN world to intercept video stream URLs
// before the page has a chance to load them.

(function () {
  if (window.__gdriveUniversalDownloader?.hooksInstalled) return;

  window.__gdriveUniversalDownloader = {
    hooksInstalled: true,
    capturedVideoURLs: new Set(),
    log: [],
    recording: false,
    settings: {},
  };

  const VIDEO_PATTERNS = [
    /googlevideo\.com/,
    /\.m3u8/,
    /\.mpd/,
    /videoplayback/,
    /mime=video/,
    /itag=\d+/,
  ];

  const isVideoURL = url => VIDEO_PATTERNS.some(p => p.test(url));
  const recordURL  = url => {
    if (url && typeof url === 'string' && isVideoURL(url))
      window.__gdriveUniversalDownloader.capturedVideoURLs.add(url);
  };

  // Skip XHR/fetch hooks on YouTube — it uses ytInitialPlayerResponse instead
  if (!/youtube\.com|youtu\.be/i.test(location.href)) {
    const OrigXHR = XMLHttpRequest;
    function HookedXHR() {
      const xhr  = new OrigXHR();
      const orig = xhr.open.bind(xhr);
      xhr.open   = (m, u, ...a) => { recordURL(u); return orig(m, u, ...a); };
      return xhr;
    }
    HookedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = HookedXHR;

    const origFetch = fetch;
    window.fetch = (input, ...a) => {
      recordURL(typeof input === 'string' ? input : input?.url);
      return origFetch.apply(window, [input, ...a]);
    };
  }
})();
