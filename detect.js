// GDrive Universal Downloader — Shared File Type Detection
// Single source of truth, injected into MAIN world by popup.js

(function () {
  const url = location.href;
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
  else if (document.querySelector('video'))                    type = 'video';
  else if (document.querySelector('audio'))                    type = 'audio';
  else if (document.querySelector('img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'))
                                                               type = 'image';
  else if (document.querySelector('.drive-viewer-text-container, .docs-texteventtarget-iframe, pre'))
                                                               type = 'text';
  else if (/drive\.google\.com\/file\/d\//i.test(url))        type = 'file-export';

  window.__gdriveUniversalDownloader = window.__gdriveUniversalDownloader || {
    capturedVideoURLs: new Set(),
    hooksInstalled: false,
  };
  window.__gdriveUniversalDownloader.detectedType = type;
})();
