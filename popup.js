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

let currentTabId = null;
let currentType  = 'unknown';
let pollInterval = null;

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
        ? `${item.w} × ${item.h}`
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

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || /^chrome(-extension)?:\/\//i.test(tab.url)) {
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
        return {
          type: GUD.detectedType || 'unknown',
          recording: !!GUD.recording,
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

    const { type, resources, recording } = results?.[0]?.result || {};
    currentType = type || 'unknown';
    const meta = TYPE_META[currentType] || TYPE_META['unknown'];
    typeBadge.textContent = meta.icon + ' ' + meta.label;
    typeBadge.className   = 'type-badge ' + currentType;

    if (meta.pdf)   pdfSettings.classList.add('visible');
    if (meta.video) videoNote.classList.add('visible');

    // If a recording is already in progress (e.g. popup was closed and reopened),
    // restore the running state and resume polling instead of showing Download.
    if (recording) {
      setBtnState(true);
      stopBtn.style.display = 'flex';
      startPolling(tab.id);
      return;
    }

    if (currentType === 'universal' && resources) {
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

    // ── Step 2: inject libraries ─────────────────────────────────────
    // Use ISOLATED world for file injections: Chrome creates a <script> element
    // for files: in MAIN world, which YouTube's nonce CSP silently blocks.
    // ISOLATED world content scripts bypass page CSP while still sharing the
    // window object (window.__gdriveUniversalDownloader) with MAIN world.
    if (currentType === 'blob-pdf') {
      appendLog('🔧 [2/3] Loading jsPDF...');
      await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'ISOLATED', files: ['lib/jspdf.umd.min.js'] });
    }

    // ── Step 3: inject downloader and do an immediate log read ───────
    appendLog('🔧 [3/3] Injecting downloader...');
    const injResult = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'ISOLATED', files: ['downloader.js'] });
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
