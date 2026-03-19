// GDrive Universal Downloader v2.5.2 — Injected Logic
// Reads state and logs to window.__gdriveUniversalDownloader

(function () {
  const GUD = window.__gdriveUniversalDownloader;
  if (!GUD) { console.warn('GUD namespace missing — hooks not installed.'); return; }
  const cfg = GUD.settings || {};
  const SCALE        = cfg.scale       ?? 1.0;
  const QUALITY      = cfg.quality     ?? 0.82;
  const SCROLL_DELAY = cfg.scrollDelay ?? 200;

  const log = (msg) => {
    console.log(msg);
    GUD.log = GUD.log || [];
    GUD.log.push(msg);
  };

  const capturedVideoURLs = GUD.capturedVideoURLs || new Set();

  log('🚀 GUD v2.5.2 starting...');

  // ── Utilities ───────────────────────────────────────────────────
  const getTitle = () => {
    const meta = document.querySelector('meta[itemprop="name"]')?.content;
    const raw  = meta || document.title;
    return raw
      .replace(/\s*[-–—]\s*Google.*/i, '')
      .replace(/\.(pdf|docx?|xlsx?|pptx?|csv|svg|txt|mp[34]|webm|jpe?g|png|gif|zip|rar)$/i, '')
      .trim() || 'gdrive-file';
  };

  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const autoScroll = async () => {
    log('⏬ Auto-scrolling to load all pages...');
    const scrollable =
      document.querySelector('.ndfHFb-c4YZDc-cYSp0e-DARUcf') ||
      document.querySelector('[role="main"]') ||
      document.documentElement;
    const step  = window.innerHeight;
    for (let pos = 0; pos <= scrollable.scrollHeight; pos += step) {
      scrollable.scrollTo(0, pos);
      await sleep(SCROLL_DELAY);
    }
    scrollable.scrollTo(0, 0);
    await sleep(300);
    log('✅ Scroll complete');
  };

  // ── File Type Detection (uses detect.js result) ─────────────────
  const url = window.location.href;

  // ── Strategy: Video ─────────────────────────────────────────────
  const processVideo = async () => {
    const title = getTitle();
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      log('📺 YouTube detected — using MediaRecorder capture...');
      const videoEl = document.querySelector('video');
      if (!videoEl) { log('❌ No video element found.'); return; }
      let stream;
      try {
        stream = videoEl.captureStream?.() || videoEl.mozCaptureStream?.();
      } catch (e) { log('❌ captureStream() failed: ' + e.message); return; }
      if (!stream) { log('❌ captureStream() not supported.'); return; }

      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks   = [];
      recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        setTimeout(() => {
          if (chunks.length === 0) { log('❌ No data recorded.'); return; }
          const blob    = new Blob(chunks, { type: 'video/webm' });
          const blobUrl = URL.createObjectURL(blob);
          triggerDownload(blobUrl, title + '.webm');
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          log('✅ Recording saved: ' + title + '.webm');
        }, 300);
      };

      videoEl.play().catch(e => log('⚠️ Playback error: ' + e.message));
      recorder.start(1000);
      log('🔴 Recording started (' + mimeType + ')');
      GUD.recording = true;
      GUD.stopRecording = () => {
        if (recorder.state === 'inactive') return;
        recorder.requestData();
        setTimeout(() => { recorder.stop(); GUD.recording = false; log('⏹ Stopped.'); }, 200);
      };
      videoEl.addEventListener('ended', () => { GUD.recording = false; GUD.stopRecording(); }, { once: true });
      return;
    }

    const isVideoURL = u => [/googlevideo\.com/, /\.m3u8/, /\.mpd/, /videoplayback/, /mime=video/, /itag=\d+/].some(p => p.test(u));
    const videoEl = document.querySelector('video');
    const domSrc  = videoEl?.src || videoEl?.querySelector('source[src]')?.src;
    if (domSrc && !domSrc.startsWith('blob:')) {
      triggerDownload(domSrc, title + '.mp4');
      log('🎬 Downloading direct MP4...');
      return;
    }

    const perfEntries = performance.getEntriesByType('resource').map(e => e.name).filter(isVideoURL);
    perfEntries.forEach(u => capturedVideoURLs.add(u));

    if (capturedVideoURLs.size === 0) {
      log('⏳ Triggering playback to capture URL...');
      if (videoEl) videoEl.play().catch(e => log('⚠️ Playback error: ' + e.message));
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        if (capturedVideoURLs.size > 0) break;
      }
    }

    if (capturedVideoURLs.size === 0) { log('⚠️ No stream URLs captured.'); return; }
    const urls      = [...capturedVideoURLs];
    const directMp4 = urls.filter(u => /\.(mp4|webm)/i.test(u) || /mime=video/i.test(u));
    if (directMp4.length > 0) {
      triggerDownload(directMp4.sort((a,b) => b.length - a.length)[0], title + '.mp4');
      log('🎬 Downloading captured MP4...');
      return;
    }
    log('⚠️ Segmented stream detected (cannot download directly).');
  };

  // ── Strategy: View-Only PDF ─────────────────────────────────────
  const processBlobPDF = async () => {
    await autoScroll();
    const blobImgs = [...document.getElementsByTagName('img')]
      .filter(img => img.src.startsWith('blob:https://drive.google.com/'));

    if (blobImgs.length === 0) { log('❌ No page images found.'); return; }
    log('📄 Found ' + blobImgs.length + ' pages. Generating PDF...');

    if (!window.jspdf) { log('❌ jsPDF library not found on page.'); return; }
    const { jsPDF } = window.jspdf;

    let pdf = null;
    for (let i = 0; i < blobImgs.length; i++) {
      const img = blobImgs[i];
      const w   = Math.round(img.width  * SCALE);
      const h   = Math.round(img.height * SCALE);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const imgData     = canvas.toDataURL('image/jpeg', QUALITY);
      const orientation = w > h ? 'l' : 'p';
      if (i === 0) {
        pdf = new jsPDF({ orientation, unit: 'px', format: [w, h] });
      } else {
        pdf.addPage([w, h], orientation);
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, w, h, '', 'FAST');
      if (i % 5 === 0) log(`  🖼️ Progress: ${i+1}/${blobImgs.length}`);
    }

    const filename = getTitle() + '.pdf';
    await pdf.save(filename, { returnPromise: true });
    log('🎉 Done! Saved as ' + filename);
  };

  // ── Execution ───────────────────────────────────────────────────
  const type  = GUD.detectedType || 'unknown';
  const title = getTitle();
  const getId = () => url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];

  log('🔍 Detected: ' + type + ' | File: ' + title);
  if (type === 'blob-pdf')  { processBlobPDF(); return; }
  if (type === 'video')     { processVideo();   return; }

  const exports = {
    'gdoc':      { path: 'document/d/', q: '/export?format=docx', ext: 'docx' },
    'gsheet':    { path: 'spreadsheets/d/', q: '/export?format=xlsx', ext: 'xlsx' },
    'gslides':   { path: 'presentation/d/', q: '/export/pptx', ext: 'pptx' },
    'gforms':    { path: 'forms/d/', q: '/export?format=csv', ext: 'csv' },
    'gdrawings': { path: 'drawings/d/', q: '/export/svg', ext: 'svg' }
  };

  if (exports[type]) {
    const id = getId();
    if (!id) { log('❌ ID missing'); return; }
    triggerDownload(`https://docs.google.com/${exports[type].path}${id}${exports[type].q}`, `${title}.${exports[type].ext}`);
    log(`📝 Exporting → ${exports[type].ext}`);
    return;
  }

  if (type === 'audio' || type === 'image') {
    const el = document.querySelector(type === 'audio' ? 'audio' : 'img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img');
    const src = el?.src || el?.querySelector('source[src]')?.src;
    if (!src) { log('⚠️ No source found'); return; }
    triggerDownload(src, title + (type === 'audio' ? '.mp3' : '.jpg'));
    log('⬇ Downloading ' + type + '...');
    return;
  }

  if (type === 'text') {
    const content = document.querySelector('.drive-viewer-text-container, pre')?.innerText ?? document.body.innerText;
    const blob    = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    triggerDownload(blobUrl, title + '.txt');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    log('📋 Saving text file...');
    return;
  }

  if (type === 'file-export') {
    const id = getId();
    if (!id) { log('❌ ID missing'); return; }
    triggerDownload(`https://drive.google.com/uc?export=download&id=${id}`, title);
    log('📁 Requesting file download...');
    return;
  }

  log('⚠️ Auto-detect failed. Refresh and try again.');
})();
