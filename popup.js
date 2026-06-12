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
let pollInterval          = null;
let pollTimeout           = null;
let _isRecording          = false;
const FALLBACK_FILENAME   = 'download.bin';
// Firefox extension IDs contain '@' (e.g. hash@temporary-addon) and are not
// valid hostnames. Chrome IDs are 32 lowercase letters and are valid hostnames.
const _extId = typeof chrome.runtime?.id === 'string' ? chrome.runtime.id : '';
const extensionInitiatorDomains = _extId && !_extId.includes('@') ? [_extId] : null;

const getSafeReferer = (value) => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
};

const sanitizeFilename = (name, fallback = FALLBACK_FILENAME) => {
  const raw = (name ?? '').toString();
  let basename = raw.split(/[/\\]/).pop() || '';
  basename = basename
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[<>:\x22|?*\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!basename) {
    if (!fallback || fallback === raw) return FALLBACK_FILENAME;
    return sanitizeFilename(fallback, FALLBACK_FILENAME);
  }
  if (basename.length > 180) {
    const extMatch = basename.match(/(\.[a-z0-9]{2,5})$/i);
    if (extMatch) {
      const keep = Math.max(1, 180 - extMatch[1].length);
      basename = basename.slice(0, keep).replace(/\.+$/, '') + extMatch[1];
    } else {
      basename = basename.slice(0, 180);
    }
  }
  return basename;
};

// Temporarily add a declarativeNetRequest session rule that sets the
// Referer header for all requests to targetUrl's hostname, run fn(),
// then remove the rule.  Works for both fetch() and chrome.downloads.
// (chrome.downloads.download() rejects 'Referer' in its own headers
//  array; this bypasses that restriction at the network layer.)
async function withReferer(targetUrl, referer, fn) {
  const safeReferer = getSafeReferer(referer);
  if (!safeReferer || !chrome.declarativeNetRequest?.updateSessionRules) {
    appendLog(`🔍 withReferer: missing API or safe referer — skipping rule`);
    return fn();
  }
  let hostname;
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      appendLog(`🔍 withReferer: non-HTTP target — skipping rule`);
      return fn();
    }
    hostname = parsedTarget.hostname;
  } catch {
    appendLog(`🔍 withReferer: invalid target URL — skipping rule`);
    return fn();
  }
  const ruleId  = ++_ruleId;
  const condition = { urlFilter: `||${hostname}/` };
  // initiatorDomains already scopes the rule to this extension only — no tabIds needed.
  // Adding tabIds would break popup-context fetch() since popup requests have tabId=-1.
  if (extensionInitiatorDomains) condition.initiatorDomains = extensionInitiatorDomains;
  appendLog(`🔍 declarativeNetRequest: Referer="${safeReferer}" for ||${hostname}/  (rule ${ruleId})`);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: ruleId, priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: safeReferer }]
        },
        condition
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

// Fetch url as a blob using popup-context fetch (CORS bypass via host_permissions)
// with Referer injection via declarativeNetRequest.
// If the response is an HTML wrapper, parses it to find the real image URL.
// Returns { blobUrl, filename } — blobUrl is a local blob:// URL so
// chrome.downloads.download() never makes a network request.
// Caller must call URL.revokeObjectURL(blobUrl) when done.
async function fetchAsBlob(url, referer, filename) {
  const fetchOne = (targetUrl, ref) => withReferer(targetUrl, ref, () => fetch(targetUrl, { credentials: 'include' }));

  let resp = await fetchOne(url, referer);
  const ct = resp.headers.get('content-type') || '';
  appendLog(`🔍 content-type: ${ct} | status: ${resp.status}`);

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  if (ct.includes('text/html')) {
    appendLog(`🔍 HTML wrapper — parsing for real image URL`);
    const text = await resp.text();
    const doc  = new DOMParser().parseFromString(text, 'text/html');
    const found = [...doc.querySelectorAll('img[src]')]
      .map(el => { try { return new URL(el.getAttribute('src'), resp.url).href; } catch { return null; } })
      .find(src => src && /^https?:\/\//i.test(src));
    if (!found) throw new Error('HTML wrapper: no <img src> found inside');
    appendLog(`✓ resolved → ${found}`);
    resp = await fetchOne(found, currentTabUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} on resolved URL`);
    const realName = decodeURIComponent(new URL(found).pathname.split('/').pop() || '');
    if (realName && /\.[a-z0-9]{2,5}$/i.test(realName)) {
      filename = sanitizeFilename(realName, filename);
    }
  }

  const blob = await resp.blob();
  return { blobUrl: URL.createObjectURL(blob), filename: sanitizeFilename(filename) };
}

// Shared inner logic for resolveUrlFallback (serialised, runs in world:MAIN).
const _pageResolveFunc = async (targetUrl, origFilename) => {
  const nameFromUrl = u => {
    try { const n = decodeURIComponent(new URL(u).pathname.split('/').pop()||''); if(n&&/\.[a-z0-9]{2,5}$/i.test(n)) return n; } catch{}
    return null;
  };
  try {
    const resp = await fetch(targetUrl, { credentials: 'include' });
    const ct   = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html')) { resp.body?.cancel(); return { resolvedUrl: targetUrl, contentType: ct, filename: origFilename }; }
    const text = await resp.text();
    const doc  = new DOMParser().parseFromString(text, 'text/html');
    const found = [...doc.querySelectorAll('video[src], source[src], img[src]')]
      .map(el => { try { return new URL(el.getAttribute('src'), resp.url).href; } catch { return null; } })
      .find(s => s && /^https?:\/\//i.test(s));
    if (!found) return { error: 'HTML wrapper: no media URL found inside' };
    return { resolvedUrl: found, contentType: ct, filename: nameFromUrl(found) || origFilename };
  } catch (e) { return { error: e.message }; }
};

// Resolve url to the real media URL with HTML wrapper detection.
// Strategy:
//   1. Page context (world:MAIN) — has browser cookies/Referer → passes Cloudflare,
//      but may fail with CORS if the CDN has no Access-Control-Allow-Origin header.
//   2. Popup context fallback — has host_permissions CORS bypass, may be blocked
//      by Cloudflare but succeeds if the URL doesn't have bot protection.
// If neither resolves the URL, returns the original URL unchanged (best-effort).
async function resolveUrlFallback(url, filename) {
  appendLog(`🔍 resolving: ${url}`);
  const fallbackName = sanitizeFilename(filename);

  // ── 1. Page context ──────────────────────────────────────────────
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTabId }, world: 'MAIN',
      func: _pageResolveFunc, args: [url, filename],
    });
    const r = results?.[0]?.result;
    if (r && !r.error) {
      appendLog(`🔍 content-type: ${r.contentType}`);
      if (r.resolvedUrl !== url) appendLog(`✓ resolved → ${r.resolvedUrl}`);
      return {
        resolvedUrl: r.resolvedUrl,
        filename: sanitizeFilename(r.filename, fallbackName)
      };
    }
    appendLog(`🔍 page context: ${r?.error} — trying popup context`);
  } catch (e) {
    appendLog(`🔍 page context error: ${e.message} — trying popup context`);
  }

  // ── 2. Popup context (CORS bypass via host_permissions) ──────────
  let resp;
  try {
    resp = await withReferer(url, currentTabUrl, () => fetch(url, { credentials: 'include' }));
  } catch (e) {
    appendLog(`⚠️ popup context also failed: ${e.message} — using original URL`);
    return { resolvedUrl: url, filename: fallbackName };
  }

  const ct = resp.headers.get('content-type') || '';
  appendLog(`🔍 content-type (popup): ${ct}`);

  if (!resp.ok) {
    appendLog(`⚠️ HTTP ${resp.status} — using original URL`);
    resp.body?.cancel();
    return { resolvedUrl: url, filename: fallbackName };
  }

  if (!ct.includes('text/html')) {
    resp.body?.cancel();
    return { resolvedUrl: url, filename: fallbackName };
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
    return { resolvedUrl: url, filename: fallbackName };
  }

  appendLog(`✓ resolved (popup) → ${found}`);
  const realName = decodeURIComponent(new URL(found).pathname.split('/').pop() || '');
  const finalName = realName && /\.[a-z0-9]{2,5}$/i.test(realName)
    ? sanitizeFilename(realName, fallbackName)
    : fallbackName;
  return { resolvedUrl: found, filename: finalName };
}
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

const stopPolling = () => {
  clearInterval(pollInterval); pollInterval = null;
  clearTimeout(pollTimeout);   pollTimeout  = null;
  _isRecording = false;
};

const startPolling = (tabId) => {
  stopPolling();

  // Safety net: re-enable the button if nothing completes.
  // While a YouTube recording is active, extend the window instead of firing.
  const scheduleTimeout = (ms) => {
    pollTimeout = setTimeout(function reschedule() {
      if (pollInterval === null) return;
      if (_isRecording) {
        appendLog('🔍 Safety timeout extended — recording in progress.');
        pollTimeout = setTimeout(reschedule, 30000);
        return;
      }
      appendLog('⚠️ Timeout — check your browser downloads or reload the page.');
      setBtnState(false);
      stopPolling();
    }, ms);
  };
  scheduleTimeout(90000);

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
      _isRecording = recording;
      stopBtn.style.display = recording ? 'flex' : 'none';
      if (!recording && downloadBtn.disabled && (runComplete || !msgs.some(m => /generating|scrolling/i.test(m)))) {
        if (runComplete || msgs.some(m => /Done|🎉|❌|⚠️ Auto-detect failed/i.test(m))) {
          setBtnState(false);
          stopPolling();
        }
      }
    } catch (e) {
      appendLog('⚠️ Lost access to tab — check your downloads.');
      setBtnState(false);
      stopPolling();
    }
  }, 500);
};

// ── Universal resource picker ────────────────────────────────────
const getFilenameFromUrl = (src, mediaType, index) => {
  const fallback = `${mediaType}-${index + 1}.${{ image: 'jpg', video: 'mp4', pdf: 'pdf' }[mediaType] || 'bin'}`;
  try {
    const parts = new URL(src).pathname.split('/');
    const name  = decodeURIComponent(parts[parts.length - 1] || '');
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return sanitizeFilename(name, fallback);
  } catch (e) { /* ignore */ }
  return sanitizeFilename(fallback);
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
      // credentials:'include' needed here — target is an authenticated Google Drive page,
      // not an open CDN. fetchBlob omits credentials because its CDN targets serve
      // wildcard CORS (Access-Control-Allow-Origin: *), which browsers reject for credentialed requests.
      const resp = await withReferer(img.src, currentTabUrl, () => fetch(img.src, { credentials: 'include' }));
      const ct   = resp.headers.get('content-type') || '';
      appendLog(`🔍 content-type: ${ct} | status: ${resp.status}`);
      if (!resp.ok) {
        appendLog(`🔍 HTTP ${resp.status} — using URL as-is`);
        return img;
      }
      if (!ct.includes('text/html')) {
        appendLog(`🔍 not HTML — using URL as-is`);
        return img;
      }
      const text = await resp.text();
      const doc  = new DOMParser().parseFromString(text, 'text/html');
      const found = [...doc.querySelectorAll('img[src]')]
        .map(el => { try { return new URL(el.getAttribute('src'), resp.url).href; } catch { return null; } })
        .find(src => src && /^https?:\/\//i.test(src));
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

// ── Minimal MP4 muxer ────────────────────────────────────────────
// Combines a video-only MP4 and an audio-only MP4 ArrayBuffer into one MP4.
// Both inputs must be non-fragmented single-track MP4 files.
function muxYouTubeMP4(videoBuf, audioBuf) {
  const r32 = (b, o) => new DataView(b).getUint32(o);
  const typ = (b, o) => String.fromCharCode(...new Uint8Array(b, o + 4, 4));

  function findBox(b, start, end, type) {
    let pos = start;
    while (pos + 8 <= end) {
      const size = r32(b, pos);
      if (size < 8) break;
      if (typ(b, pos) === type) return { offset: pos, size };
      pos += size;
    }
    return null;
  }

  function getTopBoxes(b) {
    const len = b.byteLength;
    return {
      ftyp: findBox(b, 0, len, 'ftyp'),
      moov: findBox(b, 0, len, 'moov'),
      mdat: findBox(b, 0, len, 'mdat'),
    };
  }

  function adjustedTrak(srcBuf, trak, delta) {
    const bytes = new Uint8Array(trak.size);
    bytes.set(new Uint8Array(srcBuf, trak.offset, trak.size));
    const buf = bytes.buffer;

    const mdia = findBox(buf, 8, trak.size, 'mdia');
    if (!mdia) return bytes;
    const minf = findBox(buf, mdia.offset + 8, mdia.offset + mdia.size, 'minf');
    if (!minf) return bytes;
    const stbl = findBox(buf, minf.offset + 8, minf.offset + minf.size, 'stbl');
    if (!stbl) return bytes;

    const stco = findBox(buf, stbl.offset + 8, stbl.offset + stbl.size, 'stco');
    if (stco) {
      const dv = new DataView(buf);
      const count = dv.getUint32(stco.offset + 12);
      for (let i = 0; i < count; i++) {
        const off = stco.offset + 16 + i * 4;
        dv.setUint32(off, dv.getUint32(off) + delta);
      }
    }

    const co64 = findBox(buf, stbl.offset + 8, stbl.offset + stbl.size, 'co64');
    if (co64) {
      const dv = new DataView(buf);
      const count = dv.getUint32(co64.offset + 12);
      for (let i = 0; i < count; i++) {
        const off = co64.offset + 16 + i * 8;
        const lo = dv.getUint32(off + 4);
        const sum = lo + delta;
        dv.setUint32(off + 4, sum >>> 0);
        if (delta >= 0 && sum > 0xFFFFFFFF) dv.setUint32(off, dv.getUint32(off) + 1);
        else if (delta < 0 && sum < 0)      dv.setUint32(off, dv.getUint32(off) - 1);
      }
    }
    return bytes;
  }

  const vB = getTopBoxes(videoBuf), aB = getTopBoxes(audioBuf);
  // Detect fragmented MP4 (moof boxes) — fMP4 has many mdat fragments; only the first would be
  // copied, producing a silently truncated file. Bail early with a clear error.
  if (findBox(videoBuf, 0, videoBuf.byteLength, 'moof'))
    throw new Error('Video stream is fragmented MP4 (fMP4) — mux not supported; use MediaRecorder instead');
  if (findBox(audioBuf, 0, audioBuf.byteLength, 'moof'))
    throw new Error('Audio stream is fragmented MP4 (fMP4) — mux not supported; use MediaRecorder instead');
  if (!vB.moov || !vB.mdat) throw new Error('Video stream is not a plain MP4 (no moov/mdat) — use MediaRecorder instead');
  if (!aB.moov || !aB.mdat) throw new Error('Audio stream is not a plain MP4');

  const mvhd  = findBox(videoBuf, vB.moov.offset + 8, vB.moov.offset + vB.moov.size, 'mvhd');
  const vTrak = findBox(videoBuf, vB.moov.offset + 8, vB.moov.offset + vB.moov.size, 'trak');
  const aTrak = findBox(audioBuf, aB.moov.offset + 8, aB.moov.offset + aB.moov.size, 'trak');
  if (!mvhd || !vTrak || !aTrak) throw new Error('Missing mvhd or trak box');

  const ftypSize    = vB.ftyp ? vB.ftyp.size : 0;
  const newMoovSize = 8 + mvhd.size + vTrak.size + aTrak.size;
  const vDelta = (ftypSize + newMoovSize) - vB.mdat.offset;
  const aDelta = (ftypSize + newMoovSize + vB.mdat.size) - aB.mdat.offset;

  const vTrakAdj = adjustedTrak(videoBuf, vTrak, vDelta);
  const aTrakAdj = adjustedTrak(audioBuf, aTrak, aDelta);
  const mvhdBytes = new Uint8Array(videoBuf, mvhd.offset, mvhd.size);

  const moov = new Uint8Array(newMoovSize);
  new DataView(moov.buffer).setUint32(0, newMoovSize);
  moov[4] = 0x6d; moov[5] = 0x6f; moov[6] = 0x6f; moov[7] = 0x76; // 'moov'
  let p = 8;
  moov.set(mvhdBytes, p);  p += mvhd.size;
  moov.set(vTrakAdj, p);   p += vTrak.size;
  moov.set(aTrakAdj, p);

  const total = ftypSize + newMoovSize + vB.mdat.size + aB.mdat.size;
  const out = new Uint8Array(total);
  p = 0;
  if (vB.ftyp) { out.set(new Uint8Array(videoBuf, vB.ftyp.offset, vB.ftyp.size), p); p += ftypSize; }
  out.set(moov, p);                                                                    p += newMoovSize;
  out.set(new Uint8Array(videoBuf, vB.mdat.offset, vB.mdat.size), p);                 p += vB.mdat.size;
  out.set(new Uint8Array(audioBuf, aB.mdat.offset, aB.mdat.size), p);
  return out.buffer;
}

// ── YouTube quality picker ───────────────────────────────────────
// { adaptive, progressive, bestAudio } — see init() for shape
const renderYoutubeFormatPicker = ({ adaptive, progressive, bestAudio }) => {
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
      const labels = {
        direct:       v => v.qualityLabel + ' (video only)',
        progressive:  v => v.qualityLabel + ' (direct · with audio)',
        mux:          v => v.qualityLabel + ' (mux · with audio)',
        mediarecorder:v => v.qualityLabel + ' (MediaRecorder)',
      };
      youtubeFormatLabel.textContent = (labels[value.type] || (v => v.qualityLabel))(value);
    };
    div.addEventListener('click', select);
    if (isFirst) select();
  };

  const HD_TEAL = { text: 'HD', style: 'background:#1a2a3a;color:#80cbc4' };
  const HD_BLUE = { text: 'HD' };
  const hdBadge = (h) => h >= 1080 ? HD_TEAL : h >= 720 ? HD_BLUE : null;

  let isFirst = true;
  const firstItem = (fn) => { fn(isFirst); isFirst = false; };

  // ── Section 1: Video + Audio · Direct (progressive, pre-muxed by YouTube) ──
  if (progressive.length > 0) {
    const hdr = document.createElement('div');
    hdr.className   = 'resource-section-header';
    hdr.textContent = 'Video + Audio · Direct';
    youtubeFormatList.appendChild(hdr);
    progressive.forEach(f => {
      const ext  = f.mimeType === 'video/webm' ? 'WebM' : 'MP4';
      const size = f.sizeMB > 0 ? `~${f.sizeMB} MB` : '';
      firstItem(first => addItem('🎬', f.qualityLabel, hdBadge(f.height),
        `${ext}  ${size} · with audio · quick`,
        { type: 'progressive', url: f.url, qualityLabel: f.qualityLabel, mimeType: f.mimeType },
        first));
    });
  }

  // ── Section 2: Video + Audio · Mux (adaptive video + best audio stream) ──
  // Hard limit: popup holds 3× the stream size in memory (video buf + audio buf + muxed output).
  // 300 MB total is safe for most machines; larger streams should use MediaRecorder instead.
  const MUX_MB_LIMIT = 300;
  const muxable = adaptive.filter(f => f.mimeType === 'video/mp4'
    && (f.sizeMB || 0) + (bestAudio?.sizeMB || 0) <= MUX_MB_LIMIT);
  if (muxable.length > 0 && bestAudio) {
    const hdr = document.createElement('div');
    hdr.className   = 'resource-section-header';
    hdr.textContent = 'Video + Audio · Mux';
    youtubeFormatList.appendChild(hdr);
    muxable.forEach(f => {
      const totalMB = (f.sizeMB || 0) + (bestAudio.sizeMB || 0);
      const size = totalMB > 0 ? `~${totalMB} MB` : '';
      firstItem(first => addItem('🎬', f.qualityLabel, hdBadge(f.height),
        `MP4  ${size} · with audio · mux`,
        { type: 'mux', videoUrl: f.url, audioUrl: bestAudio.url,
          qualityLabel: f.qualityLabel, videoSizeMB: f.sizeMB, audioSizeMB: bestAudio.sizeMB },
        first));
    });
  }

  // ── Section 3: With Audio via MediaRecorder ──────────────────────
  const ytQ = (h) => {
    if (h >= 2160) return 'hd2160';
    if (h >= 1440) return 'hd1440';
    if (h >= 1080) return 'hd1080';
    if (h >= 720)  return 'hd720';
    if (h >= 480)  return 'large';
    if (h >= 360)  return 'medium';
    return 'small';
  };
  const mrHeader = document.createElement('div');
  mrHeader.className   = 'resource-section-header';
  mrHeader.textContent = 'With Audio (MediaRecorder)';
  youtubeFormatList.appendChild(mrHeader);

  firstItem(first => addItem('🎥', 'Auto',
    { text: 'current quality', style: 'background:#1a2a3a;color:#80cbc4' },
    'MediaRecorder · keep tab open',
    { type: 'mediarecorder', quality: 'auto', qualityLabel: 'Auto' },
    first));

  const heights = [...new Set(adaptive.map(f => f.height))].sort((a, b) => b - a);
  heights.forEach(h => {
    firstItem(first => addItem('🎥', `${h}p`, hdBadge(h),
      'MediaRecorder · keep tab open',
      { type: 'mediarecorder', quality: ytQ(h), qualityLabel: `${h}p`, height: h },
      first));
  });

  // ── Section 4: Video Only (direct download) ──────────────────────
  if (adaptive.length > 0) {
    const voHeader = document.createElement('div');
    voHeader.className   = 'resource-section-header';
    voHeader.textContent = 'Video Only (no audio)';
    youtubeFormatList.appendChild(voHeader);
    adaptive.forEach(f => {
      const ext  = f.mimeType === 'video/webm' ? 'WebM' : 'MP4';
      const size = f.sizeMB > 0 ? `~${f.sizeMB} MB` : '';
      firstItem(first => addItem('🎬', f.qualityLabel, hdBadge(f.height), `${ext}  ${size} · no audio`,
        { type: 'direct', url: f.url, qualityLabel: f.qualityLabel, mimeType: f.mimeType, sizeMB: f.sizeMB },
        first));
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
          const seenV = new Set();
          const adaptive = [...(sd.formats || []), ...(sd.adaptiveFormats || [])]
            .filter(f => f.url && f.mimeType?.startsWith('video/') && !hasAudio(f))
            .map(toEntry)
            .sort((a, b) => b.height - a.height)
            .filter(f => { if (seenV.has(f.qualityLabel)) return false; seenV.add(f.qualityLabel); return true; });
          // Progressive (video+audio pre-muxed) — deduped by qualityLabel, sorted high→low
          const seenP = new Set();
          const progressive = [...(sd.formats || [])]
            .filter(f => f.url && f.mimeType?.startsWith('video/') && hasAudio(f))
            .map(toEntry)
            .sort((a, b) => b.height - a.height)
            .filter(f => { if (seenP.has(f.qualityLabel)) return false; seenP.add(f.qualityLabel); return true; });
          // Best audio-only stream for mux (prefer audio/mp4 = AAC)
          const audioStreams = [...(sd.adaptiveFormats || [])]
            .filter(f => f.url && f.mimeType?.startsWith('audio/'))
            .map(f => ({
              url:      f.url,
              mimeType: (f.mimeType || '').split(';')[0],
              bitrate:  f.bitrate || 0,
              sizeMB:   f.contentLength ? Math.round(parseInt(f.contentLength) / 1048576) : 0,
            }))
            .sort((a, b) => b.bitrate - a.bitrate);
          const bestAudio = audioStreams.find(f => f.mimeType === 'audio/mp4') || audioStreams[0] || null;
          youtubeFormats = { adaptive, progressive, bestAudio };
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

  // ── YouTube direct downloads (video-only or progressive with audio) ─
  if (currentType === 'video' && (selectedYoutubeFormat?.type === 'direct' || selectedYoutubeFormat?.type === 'progressive')) {
    setBtnState(true);
    logBox.innerHTML = '';
    try {
      const titleResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId }, world: 'MAIN',
        func: () => document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'video',
      });
      const fmt      = selectedYoutubeFormat;
      const ext      = fmt.mimeType === 'video/webm' ? 'webm' : 'mp4';
      const filename = sanitizeFilename((titleResult?.[0]?.result || 'video') + '.' + ext);
      const dlUrl = new URL(fmt.url);
      if (dlUrl.protocol !== 'https:' || !/googlevideo\.com$/.test(dlUrl.hostname)) {
        throw new Error('Unexpected download URL origin');
      }
      const label = fmt.type === 'progressive'
        ? `${fmt.qualityLabel} ${ext.toUpperCase()} (with audio)`
        : `${fmt.qualityLabel} ${ext.toUpperCase()} (no audio)`;
      appendLog(`⬇ Downloading ${label}...`);
      await chrome.downloads.download({ url: fmt.url, filename });
      appendLog('✅ Check your downloads folder.');
    } catch (err) {
      appendLog('❌ ' + (err?.message || String(err)));
    }
    setBtnState(false);
    return;
  }

  // ── YouTube mux download (fetch video + audio, combine into MP4) ──
  if (currentType === 'video' && selectedYoutubeFormat?.type === 'mux') {
    setBtnState(true);
    logBox.innerHTML = '';
    try {
      const fmt = selectedYoutubeFormat;
      const titleResult = await chrome.scripting.executeScript({
        target: { tabId: currentTabId }, world: 'MAIN',
        func: () => document.title.replace(/\s*-\s*YouTube\s*$/i, '').trim() || 'video',
      });
      const title    = titleResult?.[0]?.result || 'video';
      const filename = sanitizeFilename(title + '.mp4');

      for (const u of [fmt.videoUrl, fmt.audioUrl]) {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:' || !/googlevideo\.com$/.test(parsed.hostname))
          throw new Error('Unexpected stream URL origin');
      }

      const totalMB = (fmt.videoSizeMB || 0) + (fmt.audioSizeMB || 0);
      appendLog(`⬇ Fetching video stream (~${fmt.videoSizeMB} MB)...`);
      const videoResp = await fetch(fmt.videoUrl, { credentials: 'include' });
      if (!videoResp.ok) throw new Error(`Video fetch failed: ${videoResp.status}`);
      const videoBuf = await videoResp.arrayBuffer();

      appendLog(`⬇ Fetching audio stream (~${fmt.audioSizeMB} MB)...`);
      const audioResp = await fetch(fmt.audioUrl, { credentials: 'include' });
      if (!audioResp.ok) throw new Error(`Audio fetch failed: ${audioResp.status}`);
      const audioBuf = await audioResp.arrayBuffer();

      appendLog('🔧 Muxing...');
      const muxed   = muxYouTubeMP4(videoBuf, audioBuf);
      const blobUrl = URL.createObjectURL(new Blob([muxed], { type: 'video/mp4' }));
      // Revoke only after download completes — chrome.downloads.download resolves on initiation,
      // not completion, so revoking immediately risks losing the blob mid-transfer.
      const dlId = await chrome.downloads.download({ url: blobUrl, filename });
      chrome.downloads.onChanged.addListener(function revokeOnDone(delta) {
        if (delta.id === dlId && delta.state &&
            (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
          URL.revokeObjectURL(blobUrl);
          chrome.downloads.onChanged.removeListener(revokeOnDone);
        }
      });
      appendLog(`✅ ${fmt.qualityLabel} MP4 saved (${totalMB} MB).`);
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
      // Drop any items whose URL is not a valid, parseable http/https URL.
      // new URL() is safer than a regex — it normalises encoded schemes and
      // rejects javascript:, data:, file:, etc. reliably.
      selectedResources = selectedResources.filter(item => {
        try { const u = new URL(item.src); return u.protocol === 'http:' || u.protocol === 'https:'; }
        catch { return false; }
      });
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
        for (let i = 0; i < selectedResources.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 200));
          const item = selectedResources[i];
          appendLog(`🔍 download: ${item.src}`);
          const referer = item.referer || currentTabUrl;
          try {
            if (item.type === 'image') {
              // Fetch as blob in popup context (CORS bypass + DNR Referer injection).
              // HTML wrappers resolved; blob URL = no network on download.
              const { blobUrl, filename } = await fetchAsBlob(item.src, referer, item.filename);
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

if (typeof module === 'undefined') init();

// Export pure utilities for unit testing (no-op in browser where module is undefined)
if (typeof module !== 'undefined') module.exports = { sanitizeFilename, getSafeReferer, FALLBACK_FILENAME };
