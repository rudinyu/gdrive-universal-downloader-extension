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
let currentTabUrl         = null;
let currentType           = 'unknown';
let _ruleId               = 1000;

// Temporarily add a declarativeNetRequest session rule that sets the
// Referer header for all requests to targetUrl's hostname, run fn(),
// then remove the rule.  Works for both fetch() and chrome.downloads.
// (chrome.downloads.download() rejects 'Referer' in its own headers
//  array; this bypasses that restriction at the network layer.)
async function withReferer(targetUrl, referer, fn) {
  if (!referer || !chrome.declarativeNetRequest?.updateSessionRules) {
    appendLog(`🔍 withReferer: no API or no referer — skipping rule`);
    return fn();
  }
  const ruleId  = ++_ruleId;
  const hostname = new URL(targetUrl).hostname;
  appendLog(`🔍 declarativeNetRequest: set Referer="${referer}" for ||${hostname}/  (rule ${ruleId})`);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId, priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }]
        },
        condition: { urlFilter: `||${hostname}/` }
      }]
    });
    return await fn();
  } catch (e) {
    appendLog(`⚠️ withReferer error: ${e?.message || String(e)}`);
    throw e;
  } finally {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    appendLog(`🔍 rule ${ruleId} removed`);
  }
}

// ── Page-context fetch helpers ───────────────────────────────────
// Run fetch() inside the active tab's page context (world: MAIN) so that
// requests carry full browser headers (User-Agent, Accept-Language, cookies)
// and the browser's automatic Referer.  CDN bot-detection (Cloudflare, etc.)
// sees a normal browser request — popup-context fetch() gets blocked.

// Shared inner logic (serialised as string, runs in world:MAIN).
// Fetches url, detects HTML wrappers, resolves the real media URL.
// Returns { resolvedUrl, contentType, arrayBuffer?, filename } or { error }.
const _pageResolveFunc = async (targetUrl, origFilename, fetchBlob) => {
  const nameFromUrl = u => {
    try { const n = decodeURIComponent(new URL(u).pathname.split('/').pop()||''); if(n&&/\.[a-z0-9]{2,5}$/i.test(n)) return n; } catch{}
    return null;
  };
  const doFetch = async u => {
    const r = await fetch(u, { credentials: 'include' });
    return r;
  };
  try {
    let resp = await doFetch(targetUrl);
    let ct   = resp.headers.get('content-type') || '';
    let resolvedUrl = targetUrl;

    if (ct.includes('text/html')) {
      const text = await resp.text();
      const doc  = new DOMParser().parseFromString(text, 'text/html');
      const found = [...doc.querySelectorAll('video[src], source[src], img[src]')]
        .map(el => { try { return new URL(el.getAttribute('src'), resp.url).href; } catch { return null; } })
        .find(s => s && /^https?:\/\//i.test(s));
      if (!found) return { error: 'HTML wrapper: no media URL found inside' };
      resolvedUrl = found;
      resp = await doFetch(found);
      ct   = resp.headers.get('content-type') || '';
    }

    const filename = nameFromUrl(resolvedUrl) || origFilename;
    if (fetchBlob) {
      const ab = await resp.arrayBuffer();
      return { resolvedUrl, contentType: ct, arrayBuffer: ab, filename };
    }
    resp.body?.cancel();
    return { resolvedUrl, contentType: ct, filename };
  } catch (e) {
    return { error: e.message };
  }
};

// Fetch image as ArrayBuffer in page context, return as BlobURL for download.
// Blob URLs are local — chrome.downloads never hits the network again.
async function fetchImageAsBlobUrl(url, filename) {
  appendLog(`🔍 fetching in page context: ${url}`);
  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTabId }, world: 'MAIN',
    func: _pageResolveFunc, args: [url, filename, true],
  });
  const r = results?.[0]?.result;
  if (!r || r.error) throw new Error(r?.error || 'Page fetch failed');
  appendLog(`🔍 content-type: ${r.contentType} | resolved: ${r.resolvedUrl}`);
  const blob = new Blob([r.arrayBuffer]);
  return { blobUrl: URL.createObjectURL(blob), filename: r.filename };
}

// Resolve url to the real media URL with HTML wrapper detection.
// Strategy:
//   1. Page context (world:MAIN) — has browser cookies/Referer → passes Cloudflare,
//      but may fail with CORS if the CDN has no Access-Control-Allow-Origin header.
//   2. Popup context fallback — has host_permissions CORS bypass, may be blocked
//      by Cloudflare but succeeds if the URL doesn't have bot protection.
// If neither resolves the URL, returns the original URL unchanged (best-effort).
async function resolveUrlFallback(url, filename) {
  appendLog(`🔍 resolving: ${url}`);

  // ── 1. Page context ──────────────────────────────────────────────
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId }, world: 'MAIN',
      func: _pageResolveFunc, args: [url, filename, false],
    });
    const r = results?.[0]?.result;
    if (r && !r.error) {
      appendLog(`🔍 content-type: ${r.contentType}`);
      if (r.resolvedUrl !== url) appendLog(`✓ resolved → ${r.resolvedUrl}`);
      return { resolvedUrl: r.resolvedUrl, filename: r.filename };
    }
    appendLog(`🔍 page context: ${r?.error} — trying popup context`);
  } catch (e) {
    appendLog(`🔍 page context error: ${e.message} — trying popup context`);
  }

  // ── 2. Popup context (CORS bypass via host_permissions) ──────────
  let resp;
  try {
    resp = await withReferer(url, currentTabUrl, () => fetch(url));
  } catch (e) {
    appendLog(`⚠️ popup context also failed: ${e.message} — using original URL`);
    return { resolvedUrl: url, filename };
  }

  const ct = resp.headers.get('content-type') || '';
  appendLog(`🔍 content-type (popup): ${ct}`);

  if (!ct.includes('text/html')) {
    resp.body?.cancel();
    return { resolvedUrl: url, filename };
  }

  const text = await resp.text();
  const doc  = new DOMParser().parseFromString(text, 'text/html');
  // Exclude resources from the same host as the wrapper (bot-block pages embed
  // resources like logos from their own CDN — those are not the real media URL).
  const srcHost = new URL(url).hostname;
  const found = [...doc.querySelectorAll('video[src], source[src], img[src]')]
    .map(el => { try { return new URL(el.getAttribute('src'), resp.url).href; } catch { return null; } })
    .find(src => src && /^https?:\/\//i.test(src) && new URL(src).hostname !== srcHost);

  if (!found) {
    appendLog(`⚠️ HTML page found but no real media URL inside — using original`);
    return { resolvedUrl: url, filename };
  }

  appendLog(`✓ resolved (popup) → ${found}`);
  const realName = decodeURIComponent(new URL(found).pathname.split('/').pop() || '');
  if (realName && /\.[a-z0-9]{2,5}$/i.test(realName)) filename = realName;
  return { resolvedUrl: found, filename };
}
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

// Fetch preload-hint URLs that look like images but actually return HTML
// wrapper pages (e.g. manga readers). Parses the HTML, finds the real
// <img src="..."> and returns updated resource entries with the actual
// image URL and the preload URL stored as `referer`.
const resolvePreloadImages = async (images) => {
  return Promise.all(images.map(async (img) => {
    if (img.w !== 0 || img.h !== 0) return img; // skip real <img> entries
    appendLog(`🔍 resolving preload: ${img.src}`);
    try {
      const resp = await withReferer(img.src, currentTabUrl, () => fetch(img.src));
      const ct   = resp.headers.get('content-type') || '';
      appendLog(`🔍 content-type: ${ct} | status: ${resp.status}`);
      if (!ct.includes('text/html')) {
        appendLog(`🔍 not HTML — using URL as-is`);
        return img;
      }
      const text = await resp.text();
      const doc  = new DOMParser().parseFromString(text, 'text/html');
      const found = [...doc.querySelectorAll('img[src]')]
        .map(el => new URL(el.getAttribute('src'), resp.url).href)
        .find(src => /^https?:\/\//i.test(src));
      if (!found) {
        appendLog(`⚠️ no <img> found in HTML wrapper`);
        return img;
      }
      appendLog(`✓ resolved → ${found}`);
      return { ...img, src: found, referer: img.src };
    } catch (e) {
      appendLog(`⚠️ fetch failed: ${e?.message || String(e)}`);
      return img;
    }
  }));
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
      div.dataset.referer  = item.referer || '';

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
  currentTabId  = tab.id;
  currentTabUrl = tab.url;

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
      if (resources.images?.length) {
        resources.images = await resolvePreloadImages(resources.images);
      }
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
            referer:  div.dataset.referer || '',
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

      // ── Fast path: all universal resources (images, videos, PDFs) ──
      // Use chrome.downloads from the popup to bypass cross-origin <a download>
      // navigation (which is what downloader.js triggerDownload() hits for
      // cross-origin URLs and causes the "navigates to webpage" symptom).
      // Images: fetched as blob so we can detect HTML wrappers (no timing race).
      // Videos/PDFs: direct chrome.downloads (too large to buffer as blob).
      {
        let done = 0;
        for (const item of selectedResources) {
          appendLog(`🔍 download: ${item.src}`);
          const referer = item.referer || currentTabUrl;
          try {
            if (item.type === 'image') {
              // Images may be HTML wrappers (preload CDNs) — resolve in page context then blob
              const { blobUrl, filename } = await fetchImageAsBlobUrl(item.src, item.filename);
              await chrome.downloads.download({ url: blobUrl, filename });
              URL.revokeObjectURL(blobUrl);
              appendLog(`✅ ${filename}`);
            } else if (item.type === 'video') {
              // Execute download from page context so the request carries the page's
              // cookies and auto-Referer — chrome.downloads misses these and gets 403.
              // Cross-origin <a download> may briefly navigate to the video URL but
              // the download still triggers (confirmed behaviour).
              await chrome.scripting.executeScript({
                target: { tabId: currentTabId }, world: 'MAIN',
                func: (url, fname) => {
                  const a = document.createElement('a');
                  a.href = url; a.download = fname;
                  a.style.display = 'none';
                  document.body.appendChild(a);
                  a.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: false }));
                  document.body.removeChild(a);
                },
                args: [item.src, item.filename],
              });
              appendLog(`✅ ${item.filename}`);
            } else {
              // pdf — resolve HTML wrappers if present, then direct download
              const { resolvedUrl, filename } = await resolveUrlFallback(item.src, item.filename);
              await chrome.downloads.download({ url: resolvedUrl, filename });
              appendLog(`✅ ${filename}`);
            }
            done++;
          } catch (err) {
            appendLog(`❌ ${item.filename}: ${err?.message || String(err)}`);
          }
          await new Promise(r => setTimeout(r, 200));
        }
        appendLog(`🎉 Done! ${done}/${selectedResources.length} downloaded.`);
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
