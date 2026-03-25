// GDrive Universal Downloader — Popup Logic

const TYPE_META = {
  'blob-pdf':    { icon: '📄', label: 'View-Only PDF',    pdf: true  },
  'gdoc':        { icon: '📝', label: 'Google Docs',      pdf: false },
  'gsheet':      { icon: '📊', label: 'Google Sheets',    pdf: false },
  'gslides':     { icon: '📑', label: 'Google Slides',    pdf: false },
  'gforms':      { icon: '📋', label: 'Google Forms',     pdf: false },
  'gdrawings':   { icon: '🎨', label: 'Google Drawings',  pdf: false },
  'video':       { icon: '🎬', label: 'Video',            pdf: false, video: true },
  'audio':       { icon: '🎵', label: 'Audio',            pdf: false },
  'image':       { icon: '🖼️',  label: 'Image',            pdf: false },
  'text':        { icon: '📃', label: 'Text File',        pdf: false },
  'file-export': { icon: '📁', label: 'File (Drive)',     pdf: false },
  'universal':   { icon: '🌐', label: 'Universal Picker', pdf: false },
  'unknown':     { icon: '❓', label: 'Unknown',          pdf: false },
};

// ── DOM refs ─────────────────────────────────────────────────────
const typeBadge      = document.getElementById('typeBadge');
const pdfSettings    = document.getElementById('pdfSettings');
const videoNote      = document.getElementById('videoNote');
const youtubeFormatPicker = document.getElementById('youtubeFormatPicker');
const youtubeFormatList   = document.getElementById('youtubeFormatList');
const youtubeFormatLabel  = document.getElementById('youtubeFormatLabel');
const resourcePicker = document.getElementById('resourcePicker');
const resourceList   = document.getElementById('resourceList');
const resourceCount  = document.getElementById('resourceCount');
const selectAllBtn   = document.getElementById('selectAllBtn');
const selectNoneBtn  = document.getElementById('selectNoneBtn');
const downloadBtn    = document.getElementById('downloadBtn');
const btnIcon        = document.getElementById('btnIcon');
const btnText        = document.getElementById('btnText');
const stopBtn        = document.getElementById('stopBtn');
const logBox         = document.getElementById('logBox');
const scaleSlider    = document.getElementById('scaleSlider');
const scaleVal       = document.getElementById('scaleVal');
const qualitySlider  = document.getElementById('qualitySlider');
const qualityVal     = document.getElementById('qualityVal');
const mainContent        = document.getElementById('mainContent');
const unsupportedContent = document.getElementById('unsupportedContent');

let currentTabId          = null;
let currentType           = 'unknown';
let pollInterval          = null;
// { type:'mediarecorder', quality:'hd1080', qualityLabel:'1080p', height:1080 }
// | { type:'direct', url, qualityLabel, mimeType, sizeMB }
let selectedYoutubeFormat = null;

// ── Helpers ──────────────────────────────────────────────────────
const LOG_LEVELS = [
  { cls: 'err',  patterns: [/\u274C/, /error/i] },
  { cls: 'ok',   patterns: [/\u2705/, /\uD83C\uDF89/, /Done/i, /saved/i] },
  { cls: 'warn', patterns: [/\u26A0/, /warn/i] },
  { cls: 'info', patterns: [/\uD83D\uDD0D/, /\uD83D\uDCFA/, /\uD83D\uDE80/, /\uD83D\uDCC4/, /\uD83D\uDD34/] },
];

const appendLog = (msg) => {
  const line = document.createElement('div');
  for (const { cls, patterns } of LOG_LEVELS) {
    if (patterns.some(p => p.test(msg))) { line.className = cls; break; }
  }
  line.textContent = msg;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
};

const setBtnState = (running) => {
  downloadBtn.disabled = running;
  btnIcon.textContent  = running ? '⏳' : '⬇';
  if (!running && currentType === 'universal') {
    updateResourceCount(); // restore "Download (N)" label
  } else {
    btnText.textContent = running ? 'Running...' : 'Download';
  }
};

let pollTimeout = null;

const stopPolling = () => {
  clearInterval(pollInterval); pollInterval = null;
  clearTimeout(pollTimeout);   pollTimeout  = null;
};

const startPolling = (tabId) => {
  stopPolling();

  // Safety net: re-enable the button after 90 s even if nothing completes
  pollTimeout = setTimeout(() => {
    appendLog('⚠️ Timeout — check your browser downloads or reload the page.');
    setBtnState(false);
    stopPolling();
  }, 90000);

  pollInterval = setInterval(async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const GUD = window.__gdriveUniversalDownloader || {};
          const msgs = GUD.log || [];
          GUD.log = [];
          return { msgs, recording: !!GUD.recording, runComplete: !!GUD.runComplete };
        },
      });
      const { msgs = [], recording = false, runComplete = false } = results?.[0]?.result || {};
      msgs.forEach(appendLog);
      stopBtn.style.display = recording ? 'flex' : 'none';
      if (!recording && downloadBtn.disabled && (runComplete || !msgs.some(m => /generating|scrolling/i.test(m)))) {
        if (runComplete || msgs.some(m => /Done|🎉|❌|⚠️ Auto-detect failed/i.test(m))) {
          setBtnState(false);
          stopPolling();
        }
      }
    } catch (e) { stopPolling(); }
  }, 500);
};

// ── Universal resource picker ────────────────────────────────────
const getFilenameFromUrl = (src, mediaType, index) => {
  try {
    const parts = new URL(src).pathname.split('/');
    const name  = decodeURIComponent(parts[parts.length - 1] || '');
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name;
  } catch (e) { /* ignore */ }
  const exts = { image: 'jpg', video: 'mp4', pdf: 'pdf' };
  return `${mediaType}-${index + 1}.${exts[mediaType] || 'bin'}`;
};

const updateResourceCount = () => {
  const items   = resourceList.querySelectorAll('.resource-item');
  const checked = resourceList.querySelectorAll('.resource-item input:checked').length;
  downloadBtn.disabled = checked === 0;
  btnText.textContent  = checked > 0 ? `Download (${checked})` : 'Select items';
  resourceCount.textContent = `${checked} / ${items.length} selected`;
};

const renderResourcePicker = (resources) => {
  resourcePicker.style.display = 'block';
  resourceList.innerHTML = '';

  const ICONS = { image: '🖼️', video: '🎬', pdf: '📄' };

  const renderSection = (items, mediaType, title) => {
    if (items.length === 0) return;
    const header = document.createElement('div');
    header.className = 'resource-section-header';
    header.textContent = `${title} (${items.length})`;
    resourceList.appendChild(header);

    items.forEach((item, i) => {
      const filename = getFilenameFromUrl(item.src, mediaType, i);
      const div = document.createElement('div');
      div.className   = 'resource-item';
      div.dataset.src      = item.src;
      div.dataset.type     = mediaType;
      div.dataset.filename = filename;

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = true;

      const icon = document.createElement('span');
      icon.className   = 'ri-icon';
      icon.textContent = ICONS[mediaType];

      const info = document.createElement('div');
      info.className = 'ri-info';

      const name = document.createElement('div');
      name.className   = 'ri-name';
      name.textContent = filename;
      name.title       = item.src;

      const meta = document.createElement('div');
      meta.className   = 'ri-meta';
      meta.textContent = mediaType === 'image'
        ? (item.w > 0 ? `${item.w} × ${item.h}` : 'preload')
        : mediaType.toUpperCase();

      info.appendChild(name);
      info.appendChild(meta);
      div.appendChild(cb);
      div.appendChild(icon);
      div.appendChild(info);
      resourceList.appendChild(div);

      div.addEventListener('click', (e) => {
        if (e.target !== cb) cb.checked = !cb.checked;
        updateResourceCount();
      });
    });
  };

  renderSection(resources.images, 'image', 'Images');
  renderSection(resources.videos, 'video', 'Videos');
  renderSection(resources.pdfs,   'pdf',   'PDFs');
  updateResourceCount();
};

// ── YouTube quality picker ───────────────────────────────────────
// formats = video-only adaptive streams (for quality labels & direct dl)
const renderYoutubeFormatPicker = (formats) => {
  youtubeFormatPicker.style.display = 'block';
  videoNote.classList.remove('visible');
  youtubeFormatList.innerHTML = '';
  selectedYoutubeFormat = null;

  // badge = null | { text, style? }  — never use innerHTML, always textContent + DOM node
  const makeBadge = (text, style) => {
    const el = document.createElement('span');
    el.className   = 'format-badge';
    el.textContent = text;
    if (style) el.setAttribute('style', style);
    return el;
  };

  const addItem = (icon, text, badge, sublabel, value, isFirst) => {
    const div = document.createElement('div');
    div.className = 'resource-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'ytfmt';
    radio.checked = isFirst;

    const iconEl = document.createElement('span');
    iconEl.className   = 'ri-icon';
    iconEl.textContent = icon;

    const info = document.createElement('div');
    info.className = 'ri-info';

    const nameEl = document.createElement('div');
    nameEl.className   = 'ri-name';
    nameEl.textContent = text;                      // safe — no innerHTML
    if (badge) nameEl.appendChild(makeBadge(badge.text, badge.style));

    const metaEl = document.createElement('div');
    metaEl.className   = 'ri-meta';
    metaEl.textContent = sublabel;

    info.appendChild(nameEl);
    info.appendChild(metaEl);
    div.appendChild(radio);
    div.appendChild(iconEl);
    div.appendChild(info);
    youtubeFormatList.appendChild(div);

    const select = () => {
      radio.checked = true;
      selectedYoutubeFormat = value;
      downloadBtn.disabled = false;
      youtubeFormatLabel.textContent = value.type === 'direct'
        ? value.qualityLabel + ' (video only)'
        : value.qualityLabel + ' (MediaRecorder)';
    };
    div.addEventListener('click', select);
    if (isFirst) select();
  };

  const HD_TEAL = { text: 'HD', style: 'background:#1a2a3a;color:#80cbc4' };
  const HD_BLUE = { text: 'HD' };
  const hdBadge = (h) => h >= 1080 ? HD_TEAL : h >= 720 ? HD_BLUE : null;

  // ── Section 1: With Audio via MediaRecorder ──────────────────────
  const mrHeader = document.createElement('div');
  mrHeader.className   = 'resource-section-header';
  mrHeader.textContent = 'With Audio (MediaRecorder)';
  youtubeFormatList.appendChild(mrHeader);

  // Maps pixel height to YouTube player quality name
  const ytQ = (h) => {
    if (h >= 2160) return 'hd2160';
    if (h >= 1440) return 'hd1440';
    if (h >= 1080) return 'hd1080';
    if (h >= 720)  return 'hd720';
    if (h >= 480)  return 'large';
    if (h >= 360)  return 'medium';
    return 'small';
  };

  // Auto — no quality change, record whatever is currently playing
  addItem('🎥', 'Auto',
    { text: 'current quality', style: 'background:#1a2a3a;color:#80cbc4' },
    'MediaRecorder · keep tab open',
    { type: 'mediarecorder', quality: 'auto', qualityLabel: 'Auto' },
    true);

  // One entry per unique height, sorted high → low
  const heights = [...new Set(formats.map(f => f.height))].sort((a, b) => b - a);
  heights.forEach(h => {
    addItem('🎥', `${h}p`, hdBadge(h),
      'MediaRecorder · keep tab open',
      { type: 'mediarecorder', quality: ytQ(h), qualityLabel: `${h}p`, height: h },
      false);
  });

  // ── Section 2: Video Only (direct download) ──────────────────────
  if (formats.length > 0) {
    const voHeader = document.createElement('div');
    voHeader.className   = 'resource-section-header';
    voHeader.textContent = 'Video Only (no audio)';
    youtubeFormatList.appendChild(voHeader);

    formats.forEach(f => {
      const ext  = f.mimeType === 'video/webm' ? 'WebM' : 'MP4';
      const size = f.sizeMB > 0 ? `~${f.sizeMB} MB` : '';
      addItem('🎬', f.qualityLabel, hdBadge(f.height), `${ext}  ${size} · no audio`,
        { type: 'direct', url: f.url, qualityLabel: f.qualityLabel, mimeType: f.mimeType, sizeMB: f.sizeMB },
        false);
    });
  }
};

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || /^(chrome(-extension)?|moz-extension):\/\//i.test(tab.url)) {
    mainContent.style.display = 'none';
    unsupportedContent.style.display = 'block';
    return;
  }
  currentTabId = tab.id;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['detect.js'],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const GUD = window.__gdriveUniversalDownloader || {};
        let youtubeFormats = null;
        if (/youtube\.com\/watch|youtu\.be\//i.test(location.href)) {
          const sd = window.ytInitialPlayerResponse?.streamingData || {};
          const hasAudio = f => /mp4a|opus|vorbis/i.test(f.mimeType || '');
          const toEntry = (f) => ({
            url:          f.url,
            qualityLabel: f.qualityLabel || '?',
            height:       f.height || 0,
            mimeType:     (f.mimeType || '').split(';')[0],
            sizeMB:       f.contentLength ? Math.round(parseInt(f.contentLength) / 1048576) : 0,
          });
          // Video-only adaptive streams — deduped by qualityLabel, sorted high→low
          const seen = new Set();
          const adaptive = [...(sd.formats || []), ...(sd.adaptiveFormats || [])]
            .filter(f => f.url && f.mimeType?.startsWith('video/') && !hasAudio(f))
            .map(toEntry)
            .sort((a, b) => b.height - a.height)
            .filter(f => { if (seen.has(f.qualityLabel)) return false; seen.add(f.qualityLabel); return true; });
          youtubeFormats = adaptive; // always an array (may be empty)
        }
        return {
          type: GUD.detectedType || 'unknown',
          recording: !!GUD.recording,
          log: GUD.log || [],
          youtubeFormats,
          resources: GUD.universalResources
            ? {
                images: (GUD.universalResources.images || []).map(i => ({ src: i.src, alt: i.alt, w: i.w, h: i.h })),
                videos: (GUD.universalResources.videos || []).map(v => ({ src: v.src })),
                pdfs:   (GUD.universalResources.pdfs   || []).map(p => ({ src: p.src })),
              }
            : null,
        };
      },
    });

    if (!results || !results[0]) {
      throw new Error('Could not retrieve detection results');
    }

    const { type, resources, recording, log, youtubeFormats } = results[0].result || {};
    currentType = type || 'unknown';
    
    // Restore log if any
    if (log && log.length > 0) {
      log.forEach(appendLog);
    }
    const meta = TYPE_META[currentType] || TYPE_META['unknown'];
    typeBadge.textContent = meta.icon + ' ' + meta.label;
    typeBadge.className   = 'type-badge ' + currentType;

    if (meta.pdf)   pdfSettings.classList.add('visible');
    if (meta.video) videoNote.classList.add('visible'); // may be hidden by format picker below

    // If a recording is already in progress (e.g. popup was closed and reopened),
    // restore the running state and resume polling instead of showing Download.
    if (recording) {
      setBtnState(true);
      stopBtn.style.display = 'flex';
      startPolling(tab.id);
      return;
    }

    if (currentType === 'video' && youtubeFormats !== null) {
      renderYoutubeFormatPicker(youtubeFormats);
    } else if (currentType === 'universal' && resources) {
      renderResourcePicker(resources);
      // download button enabled/disabled controlled by updateResourceCount()
    } else if (currentType !== 'unknown') {
      downloadBtn.disabled = false;
    }
  } catch (e) {
    appendLog('⚠️ Access denied. Refresh the page and try again.');
  }
}

// ── Events ───────────────────────────────────────────────────────
scaleSlider.addEventListener('input',   () => scaleVal.textContent   = parseFloat(scaleSlider.value).toFixed(1));
qualitySlider.addEventListener('input', () => qualityVal.textContent = parseFloat(qualitySlider.value).toFixed(2));

selectAllBtn.addEventListener('click', () => {
  resourceList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  updateResourceCount();
});
selectNoneBtn.addEventListener('click', () => {
  resourceList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateResourceCount();
});

downloadBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  // ── YouTube video-only direct download ───────────────────────────
  if (currentType === 'video' && selectedYoutubeFormat?.type === 'direct') {
    setBtnState(true);
    logBox.innerHTML = '';
    try {
      const titleResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId }, world: 'MAIN',
        func: () => document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'video',
      });
      const safeTitle = (titleResult?.[0]?.result || 'video')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 180) || 'video';
      const ext      = selectedYoutubeFormat.mimeType === 'video/webm' ? 'webm' : 'mp4';
      const filename = safeTitle + '.' + ext;
      // Validate URL is a safe googlevideo.com HTTPS URL before downloading
      const dlUrl = new URL(selectedYoutubeFormat.url);
      if (dlUrl.protocol !== 'https:' || !/googlevideo\.com$/.test(dlUrl.hostname)) {
        throw new Error('Unexpected download URL origin');
      }
      appendLog(`⬇ Downloading ${selectedYoutubeFormat.qualityLabel} ${ext.toUpperCase()} (no audio)...`);
      await chrome.downloads.download({ url: selectedYoutubeFormat.url, filename });
      appendLog('✅ Check your downloads folder.');
    } catch (err) {
      appendLog('❌ ' + (err?.message || String(err)));
    }
    setBtnState(false);
    return;
  }

  const settings = { scale: parseFloat(scaleSlider.value), quality: parseFloat(qualitySlider.value), scrollDelay: 200 };
  setBtnState(true);
  logBox.innerHTML = '';
  appendLog('▶ Starting...');

  try {
    // Collect selected resources for universal mode
    let selectedResources = null;
    if (currentType === 'universal') {
      selectedResources = [];
      resourceList.querySelectorAll('.resource-item').forEach(div => {
        const cb = div.querySelector('input[type="checkbox"]');
        if (cb?.checked) {
          selectedResources.push({
            type:     div.dataset.type,
            src:      div.dataset.src,
            filename: div.dataset.filename,
          });
        }
      });
      // Drop any items with non-http(s) URLs (security: block javascript:, data:, etc.)
      selectedResources = selectedResources.filter(item => /^https?:\/\//i.test(item.src));
      if (selectedResources.length === 0) {
        appendLog('⚠️ No items selected.');
        setBtnState(false);
        return;
      }
    }

    // ── Step 1: set up GUD namespace ────────────────────────────────
    // Mutate the existing object (do NOT replace it) so downloader.js
    // and polling always reference the same window.__gdriveUniversalDownloader.
    appendLog('🔧 [1/3] Initializing namespace...');
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: (s, sel, type) => {
        if (!window.__gdriveUniversalDownloader) {
          window.__gdriveUniversalDownloader = { capturedVideoURLs: new Set(), hooksInstalled: false };
        }
        const g = window.__gdriveUniversalDownloader;
        g.settings          = s;
        g.log               = [];
        g.recording         = false;
        g.runComplete       = false;
        g.selectedResources = sel;
        g.detectedType      = type;
      },
      args: [settings, selectedResources, currentType],
    });

    // Verify GUD was created correctly
    const diagResult = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => {
        const g = window.__gdriveUniversalDownloader;
        return g ? `type="${g.detectedType}" sel=${JSON.stringify(g.selectedResources?.length ?? null)}` : 'GUD MISSING';
      },
    });
    appendLog('🔍 GUD: ' + (diagResult?.[0]?.result ?? 'no result'));

    // ── Step 1b: set YouTube player quality for MediaRecorder ────────
    if (currentType === 'video' && selectedYoutubeFormat?.type === 'mediarecorder'
        && selectedYoutubeFormat.quality !== 'auto') {
      appendLog(`🎬 Setting quality to ${selectedYoutubeFormat.qualityLabel}...`);
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId }, world: 'MAIN',
        func: (q) => {
          try {
            const player = document.getElementById('movie_player');
            if (player?.setPlaybackQualityRange) player.setPlaybackQualityRange(q, q);
          } catch (e) { /* ignore */ }
        },
        args: [selectedYoutubeFormat.quality],
      });
      // Wait for player to switch quality before MediaRecorder captures it
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── Step 2: inject libraries ─────────────────────────────────────
    if (currentType === 'blob-pdf') {
      appendLog('🔧 [2/3] Loading jsPDF...');
      await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', files: ['lib/jspdf.umd.min.js'] });
    }

    // ── Step 3: inject downloader and do an immediate log read ───────
    appendLog('🔧 [3/3] Injecting downloader...');
    const injResult = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', files: ['downloader.js'] });
    appendLog('✓ Injected');

    // Chrome sometimes puts script errors in result.error instead of rejecting
    const injErr = injResult?.[0]?.error;
    if (injErr) {
      appendLog('❌ Script error: ' + (injErr.message || JSON.stringify(injErr)));
      setBtnState(false);
      return;
    }

    // Post-injection probe: did the IIFE actually run?
    const probeResult = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => ({
        marker:  window.__gudRunMarker || null,
        logLen:  window.__gdriveUniversalDownloader?.log?.length ?? -1,
        firstMsg: window.__gdriveUniversalDownloader?.log?.[0] ?? '(empty)',
        type:    window.__gdriveUniversalDownloader?.detectedType ?? '?',
      }),
    });
    const probe = probeResult?.[0]?.result || {};
    appendLog(`🔬 marker=${probe.marker} logLen=${probe.logLen} type=${probe.type}`);
    appendLog(`🔬 msg[0]: ${probe.firstMsg}`);

    // Read synchronous log messages immediately (don't wait 500 ms)
    const immResult = await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => {
        const g = window.__gdriveUniversalDownloader || {};
        const msgs = g.log || [];
        g.log = [];
        return { msgs, recording: !!g.recording, runComplete: !!g.runComplete };
      },
    });
    const { msgs: immMsgs = [], recording: immRec = false, runComplete: immDone = false }
      = immResult?.[0]?.result || {};
    immMsgs.forEach(appendLog);
    stopBtn.style.display = immRec ? 'flex' : 'none';
    if (immDone) { setBtnState(false); return; }

    startPolling(currentTabId);

  } catch (err) {
    appendLog('❌ Error: ' + (err?.message || String(err)));
    setBtnState(false);
  }
});

stopBtn.addEventListener('click', async () => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => window.__gdriveUniversalDownloader?.stopRecording?.(),
    });
  } catch (e) { appendLog('❌ Stop failed.'); }
});

init();
