// GDrive Universal Downloader — Shared File Type Detection
// Single source of truth, injected into MAIN world by popup.js

(function () {
  const url = location.href;

  const SELECTORS = {
    BLOB_PDF: 'img[src^="blob:https://drive.google.com/"]',
    GDOC: /docs\.google\.com\/document/i,
    GSHEET: /docs\.google\.com\/spreadsheets/i,
    GSLIDES: /docs\.google\.com\/presentation/i,
    GFORMS: /docs\.google\.com\/forms/i,
    GDRAWINGS: /docs\.google\.com\/drawings/i,
    YOUTUBE: /youtube\.com\/watch|youtu\.be\//i,
    GDRIVE_VIDEO: 'video',
    GDRIVE_AUDIO: 'audio',
    GDRIVE_IMAGE: 'img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img',
    GDRIVE_TEXT: '.drive-viewer-text-container, .docs-texteventtarget-iframe',
    GDRIVE_FILE: /drive\.google\.com\/file\/d\//i
  };

  window.__gdriveUniversalDownloader = window.__gdriveUniversalDownloader || {
    capturedVideoURLs: new Set(),
    hooksInstalled: false,
  };
  const GUD = window.__gdriveUniversalDownloader;

  const blobImgs = [...document.querySelectorAll(SELECTORS.BLOB_PDF)];

  let type = 'unknown';
  if (blobImgs.length > 0)                          type = 'blob-pdf';
  else if (SELECTORS.GDOC.test(url))                type = 'gdoc';
  else if (SELECTORS.GSHEET.test(url))              type = 'gsheet';
  else if (SELECTORS.GSLIDES.test(url))             type = 'gslides';
  else if (SELECTORS.GFORMS.test(url))              type = 'gforms';
  else if (SELECTORS.GDRAWINGS.test(url))           type = 'gdrawings';
  else if (SELECTORS.YOUTUBE.test(url))             type = 'video';
  else if (/drive\.google\.com/i.test(url)) {
    if (document.querySelector(SELECTORS.GDRIVE_VIDEO))      type = 'video';
    else if (document.querySelector(SELECTORS.GDRIVE_AUDIO)) type = 'audio';
    else if (document.querySelector(SELECTORS.GDRIVE_IMAGE)) type = 'image';
    else if (document.querySelector(SELECTORS.GDRIVE_TEXT))  type = 'text';
    else if (SELECTORS.GDRIVE_FILE.test(url))                type = 'file-export';
  }

  // ── Universal detection for all other pages ──────────────────────
  if (type === 'unknown') {
    const images = [...document.querySelectorAll('img')]
      .filter(img => {
        const w = img.naturalWidth  || img.width;
        const h = img.naturalHeight || img.height;
        return w >= 100 && h >= 100 && img.src &&
          !img.src.startsWith('data:image/svg') &&
          !img.src.startsWith('data:image/gif;base64,R0lGODlh');
      })
      .sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight))
      .slice(0, 30)
      .map(img => ({
        type: 'image',
        src: img.src,
        alt: img.alt || img.title || '',
        w: img.naturalWidth  || img.width,
        h: img.naturalHeight || img.height,
      }));

    // Also collect images declared via <link rel="preload" as="image">.
    // Ignore fragments for deduplication, but keep the original URL for downloads.
    const getHttpUrl = (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
      } catch {
        return null;
      }
    };
    const normalizeSrc = (value) => {
      try {
        const parsed = new URL(value);
        parsed.hash = '';
        return parsed.href;
      } catch {
        return value;
      }
    };
    const seenSrcs = new Set(images.map(i => normalizeSrc(i.src)));
    const preloadImages = [...document.querySelectorAll('link[rel~="preload"][as="image"]')]
      .map(link => link.href)
      .filter(href => {
        const parsed = getHttpUrl(href);
        if (!parsed) return false;
        const key = normalizeSrc(parsed.href);
        if (seenSrcs.has(key)) return false;
        seenSrcs.add(key);
        return true;
      })
      .map(href => ({ type: 'image', src: href, alt: '', w: 0, h: 0, source: 'preload' }));

    // Canvas-based viewers can draw remote image resources without exposing
    // them as useful DOM <img> elements. Resource Timing identifies requests
    // initiated by images; accept only HTTP(S) URLs that look image-like.
    const performanceImages = [];
    const resourceEntries = typeof performance !== 'undefined' &&
      typeof performance.getEntriesByType === 'function'
      ? performance.getEntriesByType('resource')
      : [];
    const MAX_DOWNLOADS = 50; // Keep Resource Timing additions within downloader.js MAX_DOWNLOADS.
    const remainingPerformanceImageCapacity = Math.max(
      0,
      MAX_DOWNLOADS - images.length - preloadImages.length
    );
    for (const entry of resourceEntries) {
      if (performanceImages.length >= remainingPerformanceImageCapacity) break;
      if (!entry || entry.initiatorType !== 'img' || typeof entry.name !== 'string') continue;
      const parsed = getHttpUrl(entry.name);
      if (!parsed || !(/\.(?:apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i.test(parsed.pathname) ||
        /(?:image|photo)/i.test(`${parsed.pathname}${parsed.search}`))) continue;
      const key = normalizeSrc(parsed.href);
      if (seenSrcs.has(key)) continue;
      seenSrcs.add(key);
      performanceImages.push({ type: 'image', src: entry.name, alt: '', w: 0, h: 0, source: 'performance' });
    }

    const allImages = [...images, ...preloadImages, ...performanceImages];

    const videos = [...document.querySelectorAll('video')]
      .map(v => {
        const src = v.currentSrc || v.src ||
          [...v.querySelectorAll('source')].find(s => s.src)?.src || '';
        if (!src || src.startsWith('blob:')) return null;
        return { type: 'video', src, poster: v.poster || '' };
      })
      .filter(Boolean);

    const pdfEmbeds = [
      ...[...document.querySelectorAll('embed')].filter(e =>
        e.type === 'application/pdf' || /\.pdf(\?|$)/i.test(e.src)
      ).map(e => ({ type: 'pdf', src: e.src })),
      ...[...document.querySelectorAll('object')].filter(o =>
        o.type === 'application/pdf' || /\.pdf(\?|$)/i.test(o.data)
      ).map(o => ({ type: 'pdf', src: o.data })),
      ...[...document.querySelectorAll('iframe')].filter(i =>
        /\.pdf(\?|$)/i.test(i.src)
      ).map(i => ({ type: 'pdf', src: i.src })),
    ].filter(p => p.src);

    if (/\.pdf(\?|$)/i.test(url)) {
      pdfEmbeds.unshift({ type: 'pdf', src: url });
    }

    const pdfs = [...new Map(pdfEmbeds.map(p => [p.src, p])).values()];

    if (allImages.length > 0 || videos.length > 0 || pdfs.length > 0) {
      type = 'universal';
      GUD.universalResources = { images: allImages, videos, pdfs };
    }
  }

  GUD.detectedType = type;
})();
