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
let pollInterval = null;

// ── Helpers ──────────────────────────────────────────────────────
const appendLog = (msg) => {
  const line = document.createElement('div');
  if (/❌|error/i.test(msg))       line.className = 'err';
  else if (/✅|🎉|Done|saved/i.test(msg)) line.className = 'ok';
  else if (/⚠️|warn/i.test(msg))   line.className = 'warn';
  else if (/🔍|📺|🚀|📄|🔴/i.test(msg)) line.className = 'info';
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
        // Only re-enable if not obviously busy with PDF
        if (msgs.some(m => /Done|🎉|❌/i.test(m))) setBtnState(false);
      }
    } catch (e) { clearInterval(pollInterval); }
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
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const url = location.href;
        const blobImgs = [...document.getElementsByTagName('img')].filter(img => img.src.startsWith('blob:https://drive.google.com/'));
        if (blobImgs.length > 0) return 'blob-pdf';
        if (/docs\.google\.com\/document/i.test(url))     return 'gdoc';
        if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'gsheet';
        if (/docs\.google\.com\/presentation/i.test(url)) return 'gslides';
        if (/docs\.google\.com\/forms/i.test(url))        return 'gforms';
        if (/docs\.google\.com\/drawings/i.test(url))     return 'gdrawings';
        if (/youtube\.com\/watch|youtu\.be\//i.test(url)) return 'video';
        if (document.querySelector('video'))               return 'video';
        if (document.querySelector('audio'))               return 'audio';
        if (document.querySelector('img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img')) return 'image';
        if (document.querySelector('.drive-viewer-text-container, .docs-texteventtarget-iframe, pre')) return 'text';
        if (/drive\.google\.com\/file\/d\//i.test(url))   return 'file-export';
        return 'unknown';
      },
    });
    const type = results?.[0]?.result || 'unknown';
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

    // 2. Inject dependencies (Local only)
    const type = typeBadge.className.split(' ').pop();
    if (type === 'blob-pdf') {
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
