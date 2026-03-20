// GDrive Universal Downloader — Shared File Type Detection
// Single source of truth, injected into MAIN world by popup.js

(function () {
  const url = location.href;

  window.__gdriveUniversalDownloader = window.__gdriveUniversalDownloader || {
    capturedVideoURLs: new Set(),
    hooksInstalled: false,
  };
  const GUD = window.__gdriveUniversalDownloader;

  const blobImgs = [...document.getElementsByTagName('img')]
    .filter(img => img.src.startsWith('blob:https://drive.google.com/'));

  let type = 'unknown';
  if (blobImgs.length > 0)                                    type = 'blob-pdf';
  else if (/docs\.google\.com\/document/i.test(url))          type = 'gdoc';
  else if (/docs\.google\.com\/spreadsheets/i.test(url))      type = 'gsheet';
  else if (/docs\.google\.com\/presentation/i.test(url))      type = 'gslides';
  else if (/docs\.google\.com\/forms/i.test(url))             type = 'gforms';
  else if (/docs\.google\.com\/drawings/i.test(url))          type = 'gdrawings';
  else if (/youtube\.com\/watch|youtu\.be\//i.test(url))      type = 'video';
  // GDrive-only media/text viewers
  else if (/drive\.google\.com/i.test(url) && document.querySelector('video'))   type = 'video';
  else if (/drive\.google\.com/i.test(url) && document.querySelector('audio'))   type = 'audio';
  else if (document.querySelector('img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'))
                                                               type = 'image';
  else if (document.querySelector('.drive-viewer-text-container, .docs-texteventtarget-iframe'))
                                                               type = 'text';
  else if (/drive\.google\.com\/file\/d\//i.test(url))        type = 'file-export';

  // ── Universal detection for all other pages ──────────────────────
  if (type === 'unknown') {
    const images = [...document.querySelectorAll('img')]
      .filter(img => {
        const w = img.naturalWidth  || img.width;
        const h = img.naturalHeight || img.height;
        return w >= 100 && h >= 100 && img.src &&
          !img.src.startsWith('data:image/svg') &&
          !img.src.startsWith('data:image/gif;base64,R0lGODlh'); // 1x1 tracking pixels
      })
      .sort((a, b) =>
        (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight)
      )
      .slice(0, 30)
      .map(img => ({
        type: 'image',
        src: img.src,
        alt: img.alt || img.title || '',
        w: img.naturalWidth  || img.width,
        h: img.naturalHeight || img.height,
      }));

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

    // Deduplicate PDFs by src
    const pdfs = [...new Map(pdfEmbeds.map(p => [p.src, p])).values()];

    if (images.length > 0 || videos.length > 0 || pdfs.length > 0) {
      type = 'universal';
      GUD.universalResources = { images, videos, pdfs };
    }
  }

  GUD.detectedType = type;
})();
