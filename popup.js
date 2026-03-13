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

// Detect file type by running detect() logic in MAIN world
function detectType() {
  return `(function(){
    const url = location.href;
    const blobImgs = [...document.getElementsByTagName('img')]
      .filter(img => img.src.startsWith('blob:https://drive.google.com/'));
    if (blobImgs.length > 0) return 'blob-pdf';
    if (/docs\\.google\\.com\\/document/i.test(url))     return 'gdoc';
    if (/docs\\.google\\.com\\/spreadsheets/i.test(url)) return 'gsheet';
    if (/docs\\.google\\.com\\/presentation/i.test(url)) return 'gslides';
    if (/docs\\.google\\.com\\/forms/i.test(url))        return 'gforms';
    if (/docs\\.google\\.com\\/drawings/i.test(url))     return 'gdrawings';
    if (/youtube\\.com\\/watch|youtu\\.be\\//i.test(url)) return 'video';
    if (document.querySelector('video'))               return 'video';
    if (document.querySelector('audio'))               return 'audio';
    if (document.querySelector('img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'))
      return 'image';
    if (document.querySelector('.drive-viewer-text-container, .docs-texteventtarget-iframe, pre'))
      return 'text';
    if (/drive\\.google\\.com\\/file\\/d\\//i.test(url)) return 'file-export';
    return 'unknown';
  })()`;
}

// ── Supported host check ─────────────────────────────────────────
const SUPPORTED_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  'youtube.com',
  'www.youtube.com',
];

function isSupportedHost(url) {
  try {
    return SUPPORTED_HOSTS.includes(new URL(url).hostname);
  } catch { return false; }
}

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

// ── Slider display ───────────────────────────────────────────────
scaleSlider.addEventListener('input', () => {
  scaleVal.textContent = parseFloat(scaleSlider.value).toFixed(1);
});
qualitySlider.addEventListener('input', () => {
  qualityVal.textContent = parseFloat(qualitySlider.value).toFixed(2);
});

// ── Logging ──────────────────────────────────────────────────────
function appendLog(msg) {
  const line = document.createElement('div');
  if (/❌|error/i.test(msg))       line.className = 'err';
  else if (/✅|🎉|Done|saved/i.test(msg)) line.className = 'ok';
  else if (/⚠️|warn/i.test(msg))   line.className = 'warn';
  else if (/🔍|📺|🚀|📄|🔴/i.test(msg)) line.className = 'info';
  line.textContent = msg;
  logBox.appendChild(line);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── Poll for log updates from page ───────────────────────────────
let pollInterval = null;
let currentTabId = null;

function startPolling(tabId) {
  stopPolling();
  pollInterval = setInterval(async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          const msgs = window.__gdriveLog || [];
          window.__gdriveLog = [];
          return { msgs, recording: !!window.__gdriveRecording };
        },
      });
      const { msgs = [], recording = false } = results?.[0]?.result || {};
      msgs.forEach(appendLog);

      // Show/hide stop button based on recording state
      stopBtn.style.display = recording ? 'flex' : 'none';

      // If recording finished, re-enable download button
      if (!recording && stopBtn.style.display === 'none') {
        downloadBtn.disabled = false;
        btnIcon.textContent  = '⬇';
        btnText.textContent  = 'Download';
      }
    } catch (e) {
      stopPolling();
    }
  }, 400);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Init ─────────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isSupportedHost(tab.url)) {
    mainContent.style.display = 'none';
    unsupportedContent.style.display = 'block';
    return;
  }

  currentTabId = tab.id;

  // Detect file type
  let detectedType = 'unknown';
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const url = location.href;
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
        if (document.querySelector('img.stretch-fit, #drive-viewer-main-content img, .drive-viewer-content img'))
          return 'image';
        if (document.querySelector('.drive-viewer-text-container, .docs-texteventtarget-iframe, pre'))
          return 'text';
        if (/drive\.google\.com\/file\/d\//i.test(url))   return 'file-export';
        return 'unknown';
      },
    });
    detectedType = results?.[0]?.result || 'unknown';
  } catch (e) {
    appendLog('⚠️ Cannot access page. Try refreshing.');
  }

  // Update badge
  const meta = TYPE_META[detectedType] || TYPE_META['unknown'];
  typeBadge.textContent = meta.icon + ' ' + meta.label;
  typeBadge.className   = 'type-badge ' + detectedType;

  // Show relevant UI sections
  if (meta.pdf)   pdfSettings.classList.add('visible');
  if (meta.video) videoNote.classList.add('visible');

  // Enable button unless unknown
  if (detectedType !== 'unknown') {
    downloadBtn.disabled = false;
  } else {
    appendLog('⚠️ Unknown file type. Open a supported Google Drive page.');
  }
}

// ── Stop Recording ───────────────────────────────────────────────
stopBtn.addEventListener('click', async () => {
  if (!currentTabId) return;
  stopBtn.disabled = true;
  stopBtn.querySelector('span:last-child').textContent = 'Stopping...';
  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: () => {
        if (typeof window.__stopRecording === 'function') window.__stopRecording();
      },
    });
  } catch (e) {
    appendLog('❌ Could not stop recording: ' + e.message);
  } finally {
    setTimeout(() => {
      stopBtn.disabled = false;
      stopBtn.querySelector('span:last-child').textContent = 'Stop & Download';
    }, 1000);
  }
});

// ── Download ─────────────────────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
  if (!currentTabId) return;

  const settings = {
    scale:       parseFloat(scaleSlider.value),
    quality:     parseFloat(qualitySlider.value),
    scrollDelay: 200,
  };

  downloadBtn.disabled = true;
  btnIcon.textContent  = '⏳';
  btnText.textContent  = 'Running...';

  logBox.innerHTML = '';
  appendLog('▶ Starting download...');

  try {
    // Step 1: Push settings to page
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      func: (s) => {
        window.__gdriveSettings = s;
        window.__gdriveLog      = [];
      },
      args: [settings],
    });

    // Step 2: Inject downloader
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      world: 'MAIN',
      files:  ['downloader.js'],
    });

    // Start polling for logs + recording state
    startPolling(currentTabId);

    // For non-video types, re-enable button quickly
    // For video (recording), the stop button takes over — polling handles re-enable
    setTimeout(async () => {
      const isRecording = await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        world: 'MAIN',
        func: () => !!window.__gdriveRecording,
      }).then(r => r?.[0]?.result).catch(() => false);

      if (!isRecording) {
        downloadBtn.disabled = false;
        btnIcon.textContent  = '⬇';
        btnText.textContent  = 'Download';
      }
    }, 3000);

  } catch (err) {
    appendLog('❌ Injection failed: ' + err.message);
    downloadBtn.disabled = false;
    btnIcon.textContent  = '⬇';
    btnText.textContent  = 'Download';
  }
});

// Cleanup on popup close
window.addEventListener('unload', stopPolling);

init();
