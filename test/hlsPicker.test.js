const fs = require('fs');
const path = require('path');
const vm = require('vm');

const popupSource = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(__dirname, '../popup.html'), 'utf8');
const pickerStart = popupSource.indexOf('const renderResourcePicker = (resources) => {');
const pickerEnd = popupSource.indexOf('\n};', pickerStart) + 3;
if (pickerStart < 0 || pickerEnd < 3) throw new Error('Could not locate renderResourcePicker in popup.js');
const pickerSource = popupSource.slice(pickerStart, pickerEnd)
  .replace('const renderResourcePicker =', 'globalThis.renderResourcePicker =');

const makePicker = () => {
  document.body.innerHTML = `
    <div id="resourcePicker"></div>
    <div id="resourceList"></div>
    <span id="resourceCount"></span>
    <button id="downloadBtn"></button>
    <span id="btnText"></span>
    <p id="hlsPickerHint"></p>`;
  const context = {
    document,
    URL,
    resourcePicker: document.getElementById('resourcePicker'),
    resourceList: document.getElementById('resourceList'),
    resourceCount: document.getElementById('resourceCount'),
    downloadBtn: document.getElementById('downloadBtn'),
    btnText: document.getElementById('btnText'),
    hlsPickerHint: document.getElementById('hlsPickerHint'),
    getFilenameFromUrl: (_src, type, index) => `${type}-${index + 1}`,
    updateResourceCount: jest.fn(),
  };
  vm.runInNewContext(pickerSource, context);
  return context;
};

afterEach(() => { document.body.innerHTML = ''; });

test('offers a default-auto-start opt-out for choosing quality and filename first', () => {
  expect(popupHtml).toMatch(/<input type="checkbox" id="hlsManualOptions"\s*>/);
  expect(popupHtml).toContain('Choose quality and filename first');
  expect(popupSource).toContain('autoStart: !hlsManualOptions?.checked');
});

test('shows HLS beside existing universal resources without changing their default selection', () => {
  const picker = makePicker();
  picker.renderResourcePicker({
    images: [{ src: 'https://site.example/photo.jpg', w: 200, h: 100 }],
    videos: [{ src: 'https://site.example/clip.mp4' }],
    pdfs: [{ src: 'https://site.example/guide.pdf' }],
    hls: [{ src: 'https://cdn.example/private/path/index.m3u8?sig=secret' }],
  });

  const items = [...document.querySelectorAll('.resource-item')];
  expect(items.map(item => item.dataset.type)).toEqual(['image', 'video', 'pdf', 'hls']);
  expect(items.slice(0, 3).every(item => item.querySelector('input').checked)).toBe(true);
  expect(items[3].querySelector('input').checked).toBe(false);
  expect(document.getElementById('hlsPickerHint').style.display).toBe('block');
  expect(document.getElementById('resourceList').textContent).toContain('/…/…/index.m3u8');
  expect(document.getElementById('resourceList').textContent).not.toContain('private/path');
  expect(document.getElementById('resourceList').textContent).not.toContain('secret');
});

test('preselects HLS when it is the only resource type', () => {
  const picker = makePicker();
  picker.renderResourcePicker({
    images: [],
    videos: [],
    pdfs: [],
    hls: [
      { src: 'https://cdn.example/hls/master.m3u8?sig=master-secret' },
      { src: 'https://cdn.example/hls/video/720p.m3u8?sig=video-secret' },
      { src: 'https://cdn.example/hls/audio/en.m3u8?sig=audio-secret' },
    ],
  });

  const items = [...document.querySelectorAll('.resource-item')];
  expect(items.map(item => item.querySelector('input').checked)).toEqual([true, false, false]);
  expect(items.map(item => item.querySelector('.ri-meta').textContent)).toEqual([
    'Master playlist · cdn.example · /hls/master.m3u8',
    'Video playlist · cdn.example · /hls/video/720p.m3u8',
    'Audio rendition · cdn.example · /hls/audio/en.m3u8',
  ]);
  expect(document.getElementById('resourceList').textContent).not.toContain('master-secret');
  expect(document.getElementById('resourceList').textContent).not.toContain('video-secret');
  expect(document.getElementById('resourceList').textContent).not.toContain('audio-secret');
  expect(document.getElementById('hlsPickerHint').style.display).toBe('block');
});

test('keeps one HLS choice exclusive from other HLS and media selections', () => {
  const picker = makePicker();
  picker.renderResourcePicker({
    images: [{ src: 'https://site.example/photo.jpg', w: 200, h: 100 }],
    videos: [],
    pdfs: [],
    hls: [
      { src: 'https://cdn.example/master.m3u8' },
      { src: 'https://cdn.example/audio/en.m3u8' },
    ],
  });
  const items = [...document.querySelectorAll('.resource-item')];
  const [image, master, audio] = items;

  master.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(items.map(item => item.querySelector('input').checked)).toEqual([false, true, false]);
  audio.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(items.map(item => item.querySelector('input').checked)).toEqual([false, false, true]);
  image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(items.map(item => item.querySelector('input').checked)).toEqual([true, false, false]);
});
