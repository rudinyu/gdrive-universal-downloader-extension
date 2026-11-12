// GDrive Universal Downloader — Early Hook
// Injected at document_start in MAIN world to intercept video stream URLs
// before the page has a chance to load them.

(function () {
  if (window.__gdriveUniversalDownloader?.hooksInstalled) return;

  window.__gdriveUniversalDownloader = {
    hooksInstalled: true,
    capturedVideoURLs: new Set(),
    capturedHlsURLs: new Set(),
    log: [],
    recording: false,
    settings: {},
  };

  const VIDEO_PATTERNS = [
    /googlevideo\.com/,
    /\.m3u8(\?|$)/i,
    /\.mpd(\?|$)/i,
    /\.(mp4|webm|mov|ogg)(\?|$)/i,
    /videoplayback/,
    /mime=video/,
    /itag=\d+/,
    /\/video\//i,
  ];

  const isVideoURL = url => VIDEO_PATTERNS.some(p => p.test(url));
  const isHlsURL = url => /\.m3u8(?:$|[?#])/i.test(url);
  const recordURL  = url => {
    const value = typeof url === 'string' ? url : typeof url?.url === 'string' ? url.url : typeof url?.href === 'string' ? url.href : '';
    if (!value) return;
    let resolved;
    try { resolved = new URL(value, location.href); } catch { return; }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return;
    const absoluteURL = resolved.href;
    const GUD = window.__gdriveUniversalDownloader;
    if (isHlsURL(absoluteURL) && GUD.capturedHlsURLs.size < 20) GUD.capturedHlsURLs.add(absoluteURL);
    if (isVideoURL(absoluteURL) && GUD.capturedVideoURLs.size < 100) GUD.capturedVideoURLs.add(absoluteURL);
  };

  // Skip XHR/fetch hooks on YouTube — it uses ytInitialPlayerResponse instead
  if (!/youtube\.com|youtu\.be/i.test(location.href)) {
    const OrigXHR = XMLHttpRequest;
    const origOpen = OrigXHR.prototype.open;
    OrigXHR.prototype.open = function (m, u, ...a) {
      recordURL(u);
      return origOpen.call(this, m, u, ...a);
    };

    const origFetch = fetch;
    window.fetch = (input, ...a) => {
      recordURL(typeof input === 'string' ? input : input?.url);
      return origFetch.apply(window, [input, ...a]);
    };
  }
})();
