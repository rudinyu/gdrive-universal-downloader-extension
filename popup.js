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
  'unknown':     { icon: '❓', label: 'Unknown',          pdf: false },
};

const SUPPORTED_HOSTS = ['drive.google.com', 'docs.google.com', 'youtube.com', 'www.youtube.com'];

// ── DOM refs ─────────────────────────────────────────────────────
const typeBadge   = document.getElementById('typeBadge');
const pdfSettings = document.getElementById('pdfSettings');
const videoNote   = document.getElementById('videoNote');
const downloadBtn = document.getElementById('downloadBtn');
const btnIcon     = document.getElementById('btnIcon');
const btnText     = document.getElementById('btnText');
const stopBtn     = document.getElementById('stopBtn');
const logBox      = document.getElementById('logBox');
const scaleSlider = document.getElementById('scaleSlider');
const scaleVal    = document.getElementById('scaleVal');
const qualitySlider = document.getElementById('qualitySlider');
const qualityVal  = document.getElementById('qualityVal');
const mainContent       = document.getElementById('mainContent');
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
  btnText.textContent  = running ? 'Running...' : 'Download';
};

const startPolling = (tabId) => {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const GUD = window.__gdriveUniversalDownloader || {};
          const msgs = GUD.log || [];
          GUD.log = [];
          return { msgs, recording: !!GUD.recording };
        },
      });
      const { msgs = [], recording = false } = results?.[0]?.result || {};
      msgs.forEach(appendLog);
      stopBtn.style.display = recording ? 'flex' : 'none';
      if (!recording && downloadBtn.disabled && !msgs.some(m => /generating|scrolling/i.test(m))) {
        if (msgs.some(m => /Done|🎉|❌|⚠️ Auto-detect failed/i.test(m))) {
          setBtnState(false);
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    } catch (e) { clearInterval(pollInterval); pollInterval = null; }
  }, 500);
};

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !SUPPORTED_HOSTS.some(h => new URL(tab.url).hostname.includes(h))) {
    mainContent.style.display = 'none';
    unsupportedContent.style.display = 'block';
    return;
  }
  currentTabId = tab.id;

  try {
    // Inject shared detection script and read result
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['detect.js'],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => window.__gdriveUniversalDownloader?.detectedType || 'unknown',
    });
    const type = results?.[0]?.result || 'unknown';
    currentType = type;
    const meta = TYPE_META[type] || TYPE_META['unknown'];
    typeBadge.textContent = meta.icon + ' ' + meta.label;
    typeBadge.className   = 'type-badge ' + type;
    if (meta.pdf)   pdfSettings.classList.add('visible');
    if (meta.video) videoNote.classList.add('visible');
    if (type !== 'unknown') downloadBtn.disabled = false;
  } catch (e) { appendLog('⚠️ Access denied. Refresh page.'); }
}

// ── Events ───────────────────────────────────────────────────────
scaleSlider.addEventListener('input', () => scaleVal.textContent = parseFloat(scaleSlider.value).toFixed(1));
qualitySlider.addEventListener('input', () => qualityVal.textContent = parseFloat(qualitySlider.value).toFixed(2));

downloadBtn.addEventListener('click', async () => {
  if (!currentTabId) return;
  const settings = { scale: parseFloat(scaleSlider.value), quality: parseFloat(qualitySlider.value), scrollDelay: 200 };
  setBtnState(true);
  logBox.innerHTML = '';
  appendLog('▶ Starting...');

  try {
    // 1. Initialize namespace and settings
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: (s) => {
        window.__gdriveUniversalDownloader = window.__gdriveUniversalDownloader || { capturedVideoURLs: new Set() };
        window.__gdriveUniversalDownloader.settings = s;
        window.__gdriveUniversalDownloader.log = [];
      },
      args: [settings],
    });

    // 2. Re-run detection and inject dependencies
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      files: ['detect.js'],
    });
    if (currentType === 'blob-pdf') {
      await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', files: ['lib/jspdf.umd.min.js'] });
    }

    // 3. Inject downloader
    await chrome.scripting.executeScript({ target: { tabId: currentTabId }, world: 'MAIN', files: ['downloader.js'] });
    startPolling(currentTabId);

  } catch (err) {
    appendLog('❌ Failed: ' + err.message);
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
