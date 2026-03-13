// GDrive Universal Downloader v2.5 — Injected Logic
// Reads settings from window.__gdriveSettings (set by popup before injection).
// Reads captured video URLs from window.__capturedVideoURLs (set by content-hooks.js).

(function () {
  // ── Settings ────────────────────────────────────────────────────
  const cfg          = window.__gdriveSettings || {};
  const SCALE        = cfg.scale       ?? 1.0;
  const QUALITY      = cfg.quality     ?? 0.82;
  const SCROLL_DELAY = cfg.scrollDelay ?? 200;

  // ── Logging (read by popup via polling) ─────────────────────────
  window.__gdriveLog = window.__gdriveLog || [];
  const log = (msg) => {
    console.log(msg);
    window.__gdriveLog.push(msg);
  };

  // ── Video URLs captured by early hooks ──────────────────────────
  const capturedVideoURLs = window.__capturedVideoURLs || new Set();

  log('🚀 GDrive Universal Downloader v2.5 starting...');

  // ── Utilities ───────────────────────────────────────────────────
  const getTitle = () => {
    const meta = document.querySelector('meta[itemprop="name"]')?.content;
    const raw  = meta || document.title;
    return raw
      .replace(/\s*[-–—]\s*Google.*/i, '')
      .replace(/\.\w{2,5}$/, '')
      .trim() || 'gdrive-file';
  };

  const getTitleExt = () => {
    const meta  = document.querySelector('meta[itemprop="name"]')?.content;
    const raw   = meta || document.title;
    const clean = raw.replace(/\s*[-–—]\s*Google.*/i, '').trim();
    return clean.match(/\.(\w{2,5})$/)?.[1]?.toLowerCase() || null;
  };

  const triggerDownload = (url, filename) => {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    let trustedSrc = src;
    if (window.trustedTypes) {
      try {
        const policy = trustedTypes.createPolicy('gdrivePolicy', {
          createScriptURL: (input) => input,
        });
        trustedSrc = policy.createScriptURL(src);
      } catch (e) {
        try { trustedSrc = trustedTypes.getPolicy('gdrivePolicy').createScriptURL(src); }
        catch (_) {}
      }
    }
    const s = document.createElement('script');
    s.src = trustedSrc;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load: ' + src));
    document.body.appendChild(s);
  });

  const autoScroll = async () => {
    log('⏬ Auto-scrolling to load all pages...');
    const scrollable =
      document.querySelector('.ndfHFb-c4YZDc-cYSp0e-DARUcf') ||
      document.querySelector('[role="main"]') ||
      document.documentElement;
    const total = scrollable.scrollHeight;
    const step  = window.innerHeight;
    for (let pos = 0; pos <= total; pos += step) {
      scrollable.scrollTo(0, pos);
      await sleep(SCROLL_DELAY);
    }
    scrollable.scrollTo(0, 0);
    await sleep(300);
    log('✅ Scroll complete');
  };

  // ── File Type Detection ─────────────────────────────────────────
  const url = window.location.href;

  const detect = () => {
    const blobImgs = [...document.getElementsByTagName('img')]
      .filter(img => img.src.startsWith('blob:https://drive.google.com/'));
    if (blobImgs.length > 0) return 'blob-pdf';

    if (/docs\.google\.com\/document/i.test(url))     return 'gdoc';
    if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'gsheet';
    if (/docs\.google\.com\/presentation/i.test(url)) return 'gslides';
    if (/docs\.google\.com\/forms/i.test(url))        return 'gforms';
    if (/docs\.google\.com\/drawings/i.test(url))     return 'gdrawings';

    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) return 'video';
    if (document.querySelector('video'))               return 'video';
    if (document.querySelector('audio'))               return 'audio';
    if (document.querySelector(
      'img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'
    ))                                                 return 'image';
    if (document.querySelector(
      '.drive-viewer-text-container, .docs-texteventtarget-iframe, pre'
    ))                                                 return 'text';
    if (/drive\.google\.com\/file\/d\//i.test(url))   return 'file-export';

    return 'unknown';
  };

  // ── Strategy: Video ─────────────────────────────────────────────
  const processVideo = async () => {
    const title = getTitle();

    // YouTube: MediaRecorder on <video> element
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      log('📺 YouTube detected — using MediaRecorder capture...');

      const videoEl = document.querySelector('video');
      if (!videoEl) {
        log('❌ No <video> element found. Make sure the video is playing.');
        return;
      }

      let stream;
      try {
        stream = videoEl.captureStream?.() || videoEl.mozCaptureStream?.();
      } catch (e) {
        log('❌ captureStream() failed: ' + e.message);
        return;
      }
      if (!stream) {
        log('❌ captureStream() not supported. Try Chrome.');
        return;
      }

      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks   = [];

      recorder.ondataavailable = e => {
        if (e.data?.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        setTimeout(() => {
          if (chunks.length === 0) {
            log('❌ No data recorded. Video may be DRM-protected.');
            return;
          }
          const blob    = new Blob(chunks, { type: 'video/webm' });
          const mb      = (blob.size / 1024 / 1024).toFixed(1);
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl; a.download = title + '.webm';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          log('✅ Recording saved: ' + title + '.webm (' + mb + ' MB)');
          log('📁 Download should start automatically.');
        }, 300);
      };

      videoEl.play().catch(() => {});
      recorder.start(1000);

      const duration  = videoEl.duration || 0;
      const remaining = Math.max(0, duration - videoEl.currentTime);

      log('🔴 Recording started (' + mimeType + ')');
      if (duration > 0) {
        log('   Duration: ' + Math.round(duration) + 's | Remaining: ' + Math.round(remaining) + 's');
        log('   ⚠️  Do NOT close or navigate away!');
        log('   Click "Stop & Download" in the extension popup to finish early.');
      } else {
        log('   Duration unknown — click "Stop & Download" when done.');
      }
      window.__gdriveRecording = true;

      const doStop = () => {
        if (recorder.state === 'inactive') return;
        recorder.requestData();
        setTimeout(() => {
          recorder.stop();
          window.__gdriveRecording = false;
          log('⏹ Recording stopped — preparing download...');
        }, 200);
      };

      window.__stopRecording = doStop;
      videoEl.addEventListener('ended', () => {
        window.__gdriveRecording = false;
        doStop();
      }, { once: true });
      return;
    }

    // Google Drive video: check DOM + XHR/fetch captured URLs
    const isVideoURL = url => [
      /googlevideo\.com/, /\.m3u8/, /\.mpd/, /videoplayback/, /mime=video/, /itag=\d+/,
    ].some(p => p.test(url));

    const videoEl = document.querySelector('video');
    const domSrc  = videoEl?.src
      || videoEl?.querySelector('source[src]')?.src
      || [...(videoEl?.querySelectorAll('source') || [])].find(s => s.src)?.src;

    if (domSrc && !domSrc.startsWith('blob:')) {
      log('✅ Found direct video URL in DOM');
      const ext = domSrc.match(/\.(mp4|webm|mov)/i)?.[1] || 'mp4';
      triggerDownload(domSrc, title + '.' + ext);
      log('🎬 Downloading → ' + title + '.' + ext);
      return;
    }

    // Check Performance API
    const perfEntries = performance.getEntriesByType('resource')
      .map(e => e.name).filter(isVideoURL);
    perfEntries.forEach(u => capturedVideoURLs.add(u));

    if (capturedVideoURLs.size === 0) {
      log('⏳ No video URLs captured. Triggering playback...');
      if (videoEl) videoEl.play().catch(() => {});
      for (let i = 0; i < 16; i++) {
        await sleep(500);
        if (capturedVideoURLs.size > 0) break;
        if (i % 2 === 1) log('  ⌛ Waiting... (' + ((i + 1) * 0.5).toFixed(1) + 's)');
      }
    }

    if (capturedVideoURLs.size === 0) {
      log('⚠️ No video stream URLs captured.');
      log('Tip: Run the script BEFORE the video starts loading (refresh first).');
      log('Or try: Right-click video → "Save video as"');
      return;
    }

    const urls      = [...capturedVideoURLs];
    const directMp4 = urls.filter(u => /\.(mp4|webm)/i.test(u) || /mime=video/i.test(u));
    const hlsUrls   = urls.filter(u => /\.m3u8/i.test(u));
    const dashUrls  = urls.filter(u => /\.mpd/i.test(u));

    log('📊 Captured ' + urls.length + ' URL(s) — direct: ' + directMp4.length
      + ', HLS: ' + hlsUrls.length + ', DASH: ' + dashUrls.length);

    if (directMp4.length > 0) {
      const best = directMp4.sort((a, b) => b.length - a.length)[0];
      triggerDownload(best, title + '.mp4');
      log('🎬 Downloading → ' + title + '.mp4');
      return;
    }

    if (hlsUrls.length > 0 || dashUrls.length > 0) {
      log('⚠️ Segmented stream (HLS/DASH) detected — cannot download directly.');
      log('💡 Use "Video DownloadHelper" extension to capture this stream.');
      return;
    }

    log('📋 All captured URLs:');
    urls.forEach((u, i) => log('  [' + i + '] ' + u.substring(0, 100) + '...'));
  };

  // ── Strategy: View-Only PDF ─────────────────────────────────────
  const processBlobPDF = async () => {
    await autoScroll();
    const blobImgs = [...document.getElementsByTagName('img')]
      .filter(img => img.src.startsWith('blob:https://drive.google.com/'));

    if (blobImgs.length === 0) {
      log('❌ No page images found. Scroll to the bottom manually and try again.');
      return;
    }

    log('📄 Found ' + blobImgs.length + ' pages — SCALE:' + SCALE + ' QUALITY:' + QUALITY);
    await loadScript('https://unpkg.com/jspdf@latest/dist/jspdf.umd.min.js');
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
      log('  🖼️ Page ' + (i + 1) + '/' + blobImgs.length
        + ' (' + Math.floor((i + 1) / blobImgs.length * 100) + '%)');
    }

    const filename = getTitle() + '.pdf';
    await pdf.save(filename, { returnPromise: true });
    log('🎉 Done! Downloaded: ' + filename);
  };

  // ── Main ────────────────────────────────────────────────────────
  const type  = detect();
  const title = getTitle();
  const ext   = getTitleExt();
  const getId = () => url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];

  log('🔍 Detected: ' + type + ' | File: ' + title);

  if (type === 'blob-pdf')  { processBlobPDF(); return; }
  if (type === 'video')     { processVideo();   return; }

  if (type === 'gdoc') {
    const id = getId(); if (!id) { log('❌ Cannot get document ID'); return; }
    triggerDownload('https://docs.google.com/document/d/' + id + '/export?format=docx', title + '.docx');
    log('📝 Downloading → ' + title + '.docx'); return;
  }

  if (type === 'gsheet') {
    const id = getId(); if (!id) { log('❌ Cannot get spreadsheet ID'); return; }
    triggerDownload('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx', title + '.xlsx');
    log('📊 Downloading → ' + title + '.xlsx'); return;
  }

  if (type === 'gslides') {
    const id = getId(); if (!id) { log('❌ Cannot get presentation ID'); return; }
    triggerDownload('https://docs.google.com/presentation/d/' + id + '/export/pptx', title + '.pptx');
    log('📑 Downloading → ' + title + '.pptx'); return;
  }

  if (type === 'gforms') {
    const id = getId(); if (!id) { log('❌ Cannot get form ID'); return; }
    triggerDownload('https://docs.google.com/forms/d/' + id + '/export?format=csv', title + '.csv');
    log('📋 Downloading → ' + title + '.csv'); return;
  }

  if (type === 'gdrawings') {
    const id = getId(); if (!id) { log('❌ Cannot get drawing ID'); return; }
    triggerDownload('https://docs.google.com/drawings/d/' + id + '/export/svg', title + '.svg');
    log('🎨 Downloading → ' + title + '.svg'); return;
  }

  if (type === 'audio') {
    const audio = document.querySelector('audio');
    const src   = audio?.src || audio?.querySelector('source[src]')?.src;
    if (!src) { log('⚠️ Cannot get audio URL.'); return; }
    const aExt = src.match(/\.(mp3|wav|ogg|flac|aac|m4a)/i)?.[1] || ext || 'mp3';
    triggerDownload(src, title + '.' + aExt);
    log('🎵 Downloading → ' + title + '.' + aExt); return;
  }

  if (type === 'image') {
    const img = document.querySelector(
      'img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'
    );
    if (!img?.src) { log('❌ Cannot find image source'); return; }
    const iExt = img.src.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)/i)?.[1] || ext || 'jpg';
    triggerDownload(img.src, title + '.' + iExt);
    log('🖼️ Downloading → ' + title + '.' + iExt); return;
  }

  if (type === 'text') {
    const el      = document.querySelector('.drive-viewer-text-container, pre');
    const content = el?.innerText ?? document.body.innerText;
    const blob    = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(URL.createObjectURL(blob), title + '.' + (ext || 'txt'));
    log('📋 Downloading → ' + title + '.' + (ext || 'txt')); return;
  }

  if (type === 'file-export') {
    const id   = getId(); if (!id) { log('❌ Cannot get file ID'); return; }
    const fExt = ext || 'pdf';
    triggerDownload('https://drive.google.com/uc?export=download&id=' + id, title + '.' + fExt);
    log('📁 Downloading → ' + title + '.' + fExt);
    log('⚠️ If download fails, the owner has disabled downloads.'); return;
  }

  log('⚠️ Could not auto-detect file type.');
  log('Make sure you are on a Google Drive preview page and try again.');
})();
