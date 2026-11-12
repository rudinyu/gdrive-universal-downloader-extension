const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder, TextEncoder } = require('util');
const Core = require('../hls-core.js');

const pageSource = fs.readFileSync(path.join(__dirname, '../hls-page.js'), 'utf8');

const waitFor = async predicate => {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for the HLS page state to update.');
};

const mountHlsPage = ({ jobId, playlistUrl, playlists, title = 'Stream title', autoStart = true, downloadImpl, separateDownloadImpl }) => {
  const requests = [];
  const savedOptions = [];
  const job = { id: jobId, playlistUrl, referer: '', title, status: 'queued', autoStart };
  const storage = {
    getJob: jest.fn(async () => job),
    putJob: jest.fn(async () => {}),
    updateJob: jest.fn(async () => {}),
    deleteJob: jest.fn(async () => {}),
    createOutput: jest.fn(async () => ({ kind: 'opfs', maxBytes: Core.LIMITS.MAX_OPFS_OUTPUT_BYTES })),
    appendOutputChunk: jest.fn(async () => {}),
    finishOutput: jest.fn(async () => ({ kind: 'opfs', size: 3, file: new Blob([new Uint8Array([1, 2, 3])]) })),
  };
  const listeners = new Set();
  const platform = {
    storage,
    network: {
      fetch: jest.fn(async (url, options) => {
        requests.push({ url, options });
        const source = playlists.get(url);
        if (source === undefined) throw new Error('Unexpected test request.');
        const bytes = new TextEncoder().encode(source);
        return {
          status: 200,
          ok: true,
          url,
          headers: { get: name => name === 'content-length' ? String(bytes.byteLength) : 'application/vnd.apple.mpegurl' },
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      }),
    },
    permissions: { ensureHostAccess: jest.fn(async () => true) },
    tabs: { getCurrentId: jest.fn(async () => 42) },
    rules: { available: false },
    lifecycle: { kind: 'extension-tab', onPageClose: jest.fn() },
    downloads: {
      download: jest.fn(async options => { savedOptions.push(options); return 27; }),
      search: jest.fn(async () => [{ id: 27, state: 'complete' }]),
      cancel: jest.fn(async () => {}),
      onChanged: {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener),
      },
    },
  };
  const downloadSpy = jest.spyOn(Core, 'downloadMediaPlaylist').mockImplementation(async (playlist, options) => {
    if (downloadImpl) return downloadImpl(playlist, options);
    await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
    return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: playlist.container, hasAudio: true };
  });
  const separateDownloadSpy = jest.spyOn(Core, 'downloadSeparateFmp4Playlists').mockImplementation(async (video, audio, options) => {
    if (separateDownloadImpl) return separateDownloadImpl(video, audio, options);
    await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
    return {
      bytes: 3,
      segments: video.segments.length + audio.segments.length,
      videoSegments: video.segments.length,
      audioSegments: audio.segments.length,
      mediaSegments: video.segments.length + audio.segments.length,
      container: 'fmp4-av',
      hasAudio: true,
    };
  });
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:extension-output');
  URL.revokeObjectURL = jest.fn();
  document.body.innerHTML = `
    <div id="sourceLabel"></div>
    <section id="variantSection" class="hidden"><select id="variantSelect"></select></section>
    <select id="concurrencySelect"><option value="4" selected>4</option></select>
    <input id="filenameInput" type="text">
    <button id="startBtn" disabled>Start download</button>
    <button id="cancelBtn" class="hidden"></button>
    <progress id="progress" class="hidden"></progress>
    <div id="progressLabel"></div>
    <div id="status"></div>`;
  window.GUDHlsCore = Core;
  window.GUDHlsPlatform = platform;
  vm.runInNewContext(pageSource, {
    window,
    document,
    location: { href: `chrome-extension://test/hls.html?job=${jobId}`, origin: 'chrome-extension://test', search: `?job=${jobId}` },
    URL,
    URLSearchParams,
    AbortController,
    TextDecoder,
    Blob,
    setTimeout,
    clearTimeout,
    console,
  });
  return {
    requests,
    savedOptions,
    storage,
    platform,
    downloadSpy,
    separateDownloadSpy,
    cleanup() {
      downloadSpy.mockRestore();
      separateDownloadSpy.mockRestore();
      if (previousCreateObjectURL) URL.createObjectURL = previousCreateObjectURL;
      else delete URL.createObjectURL;
      if (previousRevokeObjectURL) URL.revokeObjectURL = previousRevokeObjectURL;
      else delete URL.revokeObjectURL;
      delete window.GUDHlsCore;
      delete window.GUDHlsPlatform;
      document.body.innerHTML = '';
    },
  };
};

test('the HLS job page downloads the chosen variant using the sanitized custom filename', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174000';
  const masterUrl = 'https://cdn.example/master.m3u8?sig=secret';
  const requests = [];
  const writtenChunks = [];
  const savedOptions = [];
  const sourceFor = url => {
    requests.push(url);
    if (url === masterUrl) {
      return [
        '#EXTM3U',
        '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"',
        '360/index.m3u8',
        '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
        '720/index.m3u8',
      ].join('\n');
    }
    if (url === 'https://cdn.example/360/index.m3u8') {
      return ['#EXTM3U', '#EXT-X-TARGETDURATION:4', '#EXTINF:4,', 'segment.ts', '#EXT-X-ENDLIST'].join('\n');
    }
    throw new Error('Unexpected test request.');
  };
  const storage = {
    getJob: jest.fn(async () => ({ id: jobId, playlistUrl: masterUrl, referer: '', title: 'Stream title', status: 'queued', autoStart: false })),
    putJob: jest.fn(async () => {}),
    updateJob: jest.fn(async () => {}),
    deleteJob: jest.fn(async () => { writtenChunks.length = 0; }),
    createOutput: jest.fn(async () => ({ kind: 'opfs', maxBytes: Core.LIMITS.MAX_OPFS_OUTPUT_BYTES })),
    getChunks: jest.fn(),
    appendOutputChunk: jest.fn(async (id, offset, bytes) => {
      writtenChunks.push({ jobId: id, offset, bytes: bytes.slice() });
    }),
    finishOutput: jest.fn(async () => ({ kind: 'opfs', size: 3, file: new Blob([new Uint8Array([1, 2, 3])]) })),
  };
  const changeListeners = new Set();
  const platform = {
    storage,
    network: {
      fetch: jest.fn(async (url, options) => {
        if (options.credentials !== 'include') throw new Error('This test stream requires cookies.');
        const body = new TextEncoder().encode(sourceFor(url));
        return {
          status: 200,
          ok: true,
          url,
          headers: { get: name => name === 'content-length' ? String(body.byteLength) : 'application/vnd.apple.mpegurl' },
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      }),
    },
    permissions: { ensureHostAccess: jest.fn(async () => true) },
    tabs: { getCurrentId: jest.fn(async () => 42) },
    rules: { available: false },
    lifecycle: { kind: 'extension-tab', onPageClose: jest.fn() },
    downloads: {
      download: jest.fn(async options => { savedOptions.push(options); return 12; }),
      search: jest.fn(async () => [{ id: 12, state: 'complete' }]),
      cancel: jest.fn(async () => {}),
      onChanged: {
        addListener: listener => changeListeners.add(listener),
        removeListener: listener => changeListeners.delete(listener),
      },
    },
  };
  const downloadSpy = jest.spyOn(Core, 'downloadMediaPlaylist').mockImplementation(async (_playlist, options) => {
    await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
    return { bytes: 3, segments: 1, mediaSegments: 1, container: 'ts', hasAudio: true };
  });
  const previousCreateObjectURL = URL.createObjectURL;
  const previousRevokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:extension-output');
  URL.revokeObjectURL = jest.fn();

  document.body.innerHTML = `
    <div id="sourceLabel"></div>
    <section id="variantSection" class="hidden"><select id="variantSelect"></select></section>
    <select id="concurrencySelect"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4" selected>4</option></select>
    <input id="filenameInput" type="text">
    <button id="startBtn" disabled></button>
    <button id="cancelBtn" class="hidden"></button>
    <progress id="progress" class="hidden"></progress>
    <div id="progressLabel"></div>
    <div id="status"></div>`;
  window.GUDHlsCore = Core;
  window.GUDHlsPlatform = platform;

  try {
    vm.runInNewContext(pageSource, {
      window,
      document,
      location: { href: `chrome-extension://test/hls.html?job=${jobId}`, search: `?job=${jobId}` },
      URL,
      URLSearchParams,
      AbortController,
      TextDecoder,
      Blob,
      setTimeout,
      clearTimeout,
      console,
    });

    const variantSelect = document.getElementById('variantSelect');
    await waitFor(() => variantSelect.options.length === 2);
    const concurrencySelect = document.getElementById('concurrencySelect');
    expect(concurrencySelect.value).toBe('4');
    expect(variantSelect.options[0].textContent).toContain('720p');
    expect(variantSelect.options[1].textContent).toContain('360p');
    expect(downloadSpy).not.toHaveBeenCalled();

    variantSelect.value = '1';
    variantSelect.dispatchEvent(new window.Event('change'));
    concurrencySelect.value = '2';
    const filenameInput = document.getElementById('filenameInput');
    filenameInput.value = '../My custom : video.avi';
    document.getElementById('startBtn').click();
    await waitFor(() => savedOptions.length === 1);

    expect(requests).toEqual([masterUrl, 'https://cdn.example/360/index.m3u8']);
    expect(platform.network.fetch.mock.calls.map(([, options]) => options.credentials)).toEqual(['include', 'include']);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy.mock.calls[0][1].concurrency).toBe(2);
    expect(downloadSpy.mock.calls[0][1].maxOutputBytes).toBe(Core.LIMITS.MAX_OPFS_OUTPUT_BYTES);
    expect(storage.finishOutput).toHaveBeenCalledWith(jobId);
    expect(storage.getChunks).not.toHaveBeenCalled();
    expect(savedOptions[0]).toMatchObject({ url: 'blob:extension-output', filename: 'My custom _ video.mp4', saveAs: false });
    expect(filenameInput.value).toBe('My custom _ video.mp4');
  } finally {
    downloadSpy.mockRestore();
    if (previousCreateObjectURL) URL.createObjectURL = previousCreateObjectURL;
    else delete URL.createObjectURL;
    if (previousRevokeObjectURL) URL.revokeObjectURL = previousRevokeObjectURL;
    else delete URL.revokeObjectURL;
    delete window.GUDHlsCore;
    delete window.GUDHlsPlatform;
    document.body.innerHTML = '';
  }
});

test('automatically starts a validated media playlist once and ignores duplicate start events', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174010';
  const playlistUrl = 'https://cdn.example/index.m3u8';
  const playlists = new Map([[playlistUrl, ['#EXTM3U', '#EXTINF:4,', 'segment.ts', '#EXT-X-ENDLIST'].join('\n')]]);
  let announceStart;
  const started = new Promise(resolve => { announceStart = resolve; });
  let releaseDownload;
  const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
  const harness = mountHlsPage({
    jobId,
    playlistUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      announceStart();
      await downloadGate;
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: playlist.container, hasAudio: true };
    },
  });

  try {
    await started;
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.downloadSpy.mock.calls[0][0].segments[0].url).toBe('https://cdn.example/segment.ts');
    expect(harness.storage.createOutput).toHaveBeenCalledTimes(1);

    document.getElementById('startBtn').dispatchEvent(new window.Event('click', { bubbles: true }));
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    releaseDownload();
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.savedOptions[0].filename).toBe('Stream title.mp4');
    expect(document.getElementById('status').textContent).toBe('MP4 download completed.');
  } finally {
    releaseDownload();
    harness.cleanup();
  }
});

test('automatically chooses the highest supported master variant', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174011';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"',
      'low/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      'high/index.m3u8',
    ].join('\n')],
    ['https://cdn.example/high/index.m3u8', ['#EXTM3U', '#EXTINF:4,', 'high.ts', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({ jobId, playlistUrl: masterUrl, playlists });

  try {
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.requests.map(request => request.url)).toEqual([masterUrl, 'https://cdn.example/high/index.m3u8']);
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.downloadSpy.mock.calls[0][0].segments[0].url).toBe('https://cdn.example/high/high.ts');
    expect(harness.savedOptions[0].filename).toBe('Stream title.mp4');
  } finally {
    harness.cleanup();
  }
});

test('automatically downloads a separate fMP4 audio rendition into the same MP4', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174020';
  const masterUrl = 'https://cdn.example/master.m3u8?token=private';
  const videoUrl = 'https://cdn.example/video/video.m3u8';
  const audioUrl = 'https://cdn.example/audio/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="audio/audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"',
      'video/video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:1,', 'v0.m4s', '#EXTINF:1,', 'v1.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:1,', 'a0.m4s', '#EXTINF:1,', 'a1.m4s', '#EXTINF:1,', 'a2.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  let announceStart;
  const started = new Promise(resolve => { announceStart = resolve; });
  let releaseDownload;
  const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    separateDownloadImpl: async (video, audio, options) => {
      announceStart();
      await downloadGate;
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return {
        bytes: 3,
        segments: video.segments.length + audio.segments.length,
        videoSegments: video.segments.length,
        audioSegments: audio.segments.length,
        mediaSegments: video.segments.length + audio.segments.length,
        container: 'fmp4-av',
        hasAudio: true,
      };
    },
  });

  try {
    await started;
    expect(harness.requests.map(request => request.url)).toEqual([masterUrl, videoUrl, audioUrl]);
    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.separateDownloadSpy.mock.calls[0][0].segments).toHaveLength(2);
    expect(harness.separateDownloadSpy.mock.calls[0][1].segments).toHaveLength(3);
    expect(document.getElementById('variantSelect').options[0].textContent).toContain('separate audio available');
    document.getElementById('startBtn').click();
    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    releaseDownload();
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.savedOptions[0].filename).toBe('Stream title.mp4');
    expect(document.getElementById('status').textContent).toBe('MP4 download completed.');
  } finally {
    releaseDownload();
    harness.cleanup();
  }
});

test('adds the no-audio suffix and status for a regular video-only playlist', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174024';
  const playlistUrl = 'https://cdn.example/video-only.m3u8';
  const playlists = new Map([[playlistUrl, ['#EXTM3U', '#EXTINF:1,', 'video.ts', '#EXT-X-ENDLIST'].join('\n')]]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: 'ts', hasAudio: false };
    },
  });

  try {
    await waitFor(() => harness.savedOptions.length === 1);
    expect(harness.savedOptions[0].filename).toBe('Stream title-no音訊.mp4');
    expect(document.getElementById('filenameInput').value).toBe('Stream title-no音訊.mp4');
    expect(document.getElementById('status').textContent).toContain('No audio track was included');
    expect(document.getElementById('progressLabel').textContent).toContain('No audio');
  } finally {
    harness.cleanup();
  }
});

test('falls back to video when the separate audio playlist is encrypted', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174025';
  const masterUrl = 'https://cdn.example/master.m3u8?token=private';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: 'fmp4', hasAudio: false };
    },
  });

  try {
    await waitFor(() => harness.savedOptions.length === 1);
    expect(harness.separateDownloadSpy).not.toHaveBeenCalled();
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.storage.createOutput).toHaveBeenCalledTimes(2);
    expect(harness.savedOptions[0].filename).toBe('Stream title-no音訊.mp4');
    expect(document.getElementById('status').textContent).toContain('No audio track was included');
    expect(document.body.textContent).not.toContain('private');
  } finally {
    harness.cleanup();
  }
});

test('resets partial combined output before a sanitized video-only retry', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174026';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="a-init.mp4"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    autoStart: false,
    separateDownloadImpl: async (_video, _audio, options) => {
      await options.appendChunk(new Uint8Array([9, 9, 9]), 0);
      const error = new Core.HlsError('Separate audio fragments are incompatible.', 'HLS_UNSUPPORTED');
      error.hlsAudioFallback = true;
      throw error;
    },
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: 'fmp4', hasAudio: false };
    },
  });

  try {
    await waitFor(() => document.getElementById('variantSelect').options.length === 1);
    const filenameInput = document.getElementById('filenameInput');
    filenameInput.value = '../My recording-no音訊.avi';
    document.getElementById('startBtn').click();
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.storage.createOutput).toHaveBeenCalledTimes(2);
    expect(harness.storage.appendOutputChunk.mock.calls.map(([, offset]) => offset)).toEqual([0, 0]);
    expect(harness.savedOptions[0].filename).toBe('My recording-no音訊.mp4');
    expect(filenameInput.value).toBe('My recording-no音訊.mp4');
    expect(document.getElementById('status').textContent).toContain('No audio track was included');
  } finally {
    harness.cleanup();
  }
});

test('does not fall back to video when video download fails', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174027';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="a-init.mp4"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    separateDownloadImpl: async () => { throw new Core.HlsError('Video rendition segment failed.', 'HLS_NETWORK'); },
  });

  try {
    await waitFor(() => document.getElementById('status').textContent.includes('Video rendition segment failed'));
    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.savedOptions).toHaveLength(0);
  } finally {
    harness.cleanup();
  }
});

test('does not fall back to video after cancellation during separate-audio download', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174028';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="a-init.mp4"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    separateDownloadImpl: async (_video, _audio, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Core.HlsError('Download cancelled.', 'HLS_CANCELLED')), { once: true });
    }),
  });

  try {
    await waitFor(() => harness.separateDownloadSpy.mock.calls.length === 1);
    document.getElementById('cancelBtn').click();
    await waitFor(() => document.getElementById('status').textContent === 'Download cancelled.');
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.savedOptions).toHaveLength(0);
  } finally {
    harness.cleanup();
  }
});

test('does not dispatch a finalized OPFS output when cancellation happens during finalization', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174030';
  const playlistUrl = 'https://cdn.example/index.m3u8';
  const playlists = new Map([[playlistUrl, ['#EXTM3U', '#EXTINF:1,', 'segment.ts', '#EXT-X-ENDLIST'].join('\n')]]);
  let resolveFinish;
  const harness = mountHlsPage({
    jobId,
    playlistUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: 'ts', hasAudio: true };
    },
  });
  harness.storage.finishOutput.mockImplementation(() => new Promise(resolve => { resolveFinish = resolve; }));

  try {
    await waitFor(() => typeof resolveFinish === 'function');
    document.getElementById('cancelBtn').click();
    resolveFinish({ kind: 'opfs', size: 3, file: new Blob([new Uint8Array([1, 2, 3])]) });
    await waitFor(() => document.getElementById('status').textContent === 'Download cancelled.');

    expect(harness.platform.downloads.download).not.toHaveBeenCalled();
    expect(document.getElementById('status').textContent).not.toContain('completed');
  } finally {
    harness.cleanup();
  }
});

test('cancels a native browser download when its ID resolves after abort', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174031';
  const playlistUrl = 'https://cdn.example/index.m3u8';
  const playlists = new Map([[playlistUrl, ['#EXTM3U', '#EXTINF:1,', 'segment.ts', '#EXT-X-ENDLIST'].join('\n')]]);
  let resolveDownload;
  const harness = mountHlsPage({ jobId, playlistUrl, playlists });
  harness.platform.downloads.download.mockImplementation(() => new Promise(resolve => { resolveDownload = resolve; }));

  try {
    await waitFor(() => typeof resolveDownload === 'function');
    document.getElementById('cancelBtn').click();
    resolveDownload(81);
    await waitFor(() => document.getElementById('status').textContent === 'Download cancelled.');

    expect(harness.platform.downloads.cancel).toHaveBeenCalledWith(81);
    expect(document.getElementById('status').textContent).not.toContain('completed');
  } finally {
    harness.cleanup();
  }
});

test('waits for explicit start when a separate-audio master uses manual selection mode', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174021';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="a-init.mp4"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({ jobId, playlistUrl: masterUrl, playlists, autoStart: false });

  try {
    await waitFor(() => document.getElementById('variantSelect').options.length === 1);
    expect(document.getElementById('status').textContent).toContain('Choose a supported variant');
    expect(harness.separateDownloadSpy).not.toHaveBeenCalled();
    expect(harness.requests.map(request => request.url)).toEqual([masterUrl]);

    document.getElementById('startBtn').click();
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.separateDownloadSpy.mock.calls[0][0].segments).toHaveLength(1);
    expect(harness.separateDownloadSpy.mock.calls[0][1].segments).toHaveLength(1);
    expect(harness.savedOptions[0].filename).toBe('Stream title.mp4');
  } finally {
    harness.cleanup();
  }
});

test('falls back to a valid video-only TS playlist when separate audio is incompatible', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174023';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXTINF:1,', 'v.ts', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXTINF:1,', 'a.ts', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: playlist.container, hasAudio: false };
    },
  });

  try {
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.requests.map(request => request.url)).toEqual([masterUrl, videoUrl, audioUrl]);
    expect(harness.separateDownloadSpy).not.toHaveBeenCalled();
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.savedOptions[0].filename).toBe('Stream title-no音訊.mp4');
    expect(document.getElementById('status').textContent).toContain('No audio track was included');
  } finally {
    harness.cleanup();
  }
});

test('continues video-only when CODECS is omitted for an optional external audio rendition', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174032';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const videoUrl = 'https://cdn.example/video.m3u8';
  const audioUrl = 'https://cdn.example/audio.m3u8';
  const playlists = new Map([
    [masterUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXTINF:1,', 'v.ts', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXTINF:1,', 'a.ts', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({
    jobId,
    playlistUrl: masterUrl,
    playlists,
    downloadImpl: async (playlist, options) => {
      await options.appendChunk(new Uint8Array([1, 2, 3]), 0);
      return { bytes: 3, segments: playlist.segments.length, mediaSegments: 1, container: playlist.container, hasAudio: false };
    },
  });

  try {
    await waitFor(() => harness.savedOptions.length === 1);
    expect(harness.requests.map(request => request.url)).toEqual([masterUrl, videoUrl, audioUrl]);
    expect(harness.separateDownloadSpy).not.toHaveBeenCalled();
    expect(harness.downloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.savedOptions[0].filename).toBe('Stream title-no音訊.mp4');
    expect(document.getElementById('status').textContent).toContain('No audio track was included');
  } finally {
    harness.cleanup();
  }
});

test('preserves a separate audio rendition selected by a nested master playlist', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174022';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const nestedUrl = 'https://cdn.example/nested/index.m3u8';
  const videoUrl = 'https://cdn.example/nested/video.m3u8';
  const audioUrl = 'https://cdn.example/nested/audio.m3u8';
  const playlists = new Map([
    [masterUrl, ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=2400000,CODECS="avc1.640028,mp4a.40.2"', 'nested/index.m3u8'].join('\n')],
    [nestedUrl, [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1800000,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"',
      'video.m3u8',
    ].join('\n')],
    [videoUrl, ['#EXTM3U', '#EXT-X-MAP:URI="v-init.mp4"', '#EXTINF:1,', 'v.m4s', '#EXT-X-ENDLIST'].join('\n')],
    [audioUrl, ['#EXTM3U', '#EXT-X-MAP:URI="a-init.mp4"', '#EXTINF:1,', 'a.m4s', '#EXT-X-ENDLIST'].join('\n')],
  ]);
  const harness = mountHlsPage({ jobId, playlistUrl: masterUrl, playlists });

  try {
    await waitFor(() => harness.savedOptions.length === 1);

    expect(harness.requests.map(request => request.url)).toEqual([masterUrl, nestedUrl, videoUrl, audioUrl]);
    expect(harness.separateDownloadSpy).toHaveBeenCalledTimes(1);
    expect(harness.separateDownloadSpy.mock.calls[0][0].segments).toHaveLength(1);
    expect(harness.separateDownloadSpy.mock.calls[0][1].segments).toHaveLength(1);
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.savedOptions[0].filename).toBe('Stream title.mp4');
  } finally {
    harness.cleanup();
  }
});

test('does not auto-start a master playlist when every variant is unsupported', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174013';
  const masterUrl = 'https://cdn.example/master.m3u8';
  const playlists = new Map([[masterUrl, [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS="hvc1.1.6.L93.B0,mp4a.40.2"',
    'unsupported/index.m3u8',
  ].join('\n')]]);
  const harness = mountHlsPage({ jobId, playlistUrl: masterUrl, playlists });

  try {
    await waitFor(() => document.getElementById('status').textContent.includes('no supported variant'));
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.storage.createOutput).not.toHaveBeenCalled();
    expect(harness.requests.map(request => request.url)).toEqual([masterUrl]);
    expect(document.getElementById('startBtn').disabled).toBe(true);
  } finally {
    harness.cleanup();
  }
});

test('does not auto-start media playlists that are known to be unsupported', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174012';
  const playlistUrl = 'https://cdn.example/fmp4.m3u8';
  const playlists = new Map([[playlistUrl, [
    '#EXTM3U',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:4,',
    '#EXT-X-DISCONTINUITY',
    'segment.m4s',
    '#EXT-X-ENDLIST',
  ].join('\n')]]);
  const harness = mountHlsPage({ jobId, playlistUrl, playlists });

  try {
    await waitFor(() => document.getElementById('status').textContent.includes('Discontinuities in fMP4'));
    expect(harness.downloadSpy).not.toHaveBeenCalled();
    expect(harness.storage.createOutput).not.toHaveBeenCalled();
    expect(harness.requests.map(request => request.url)).toEqual([playlistUrl]);
  } finally {
    harness.cleanup();
  }
});

test('retries cross-origin CORS rejection without credentials and deletes stored jobs on page close', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174001';
  const playlistUrl = 'https://cdn.example/index.m3u8?sig=private';
  const body = new TextEncoder().encode(['#EXTM3U', '#EXTINF:4,', 'segment.ts', '#EXT-X-ENDLIST'].join('\n'));
  const requests = [];
  const pageCloseHandlers = [];
  const storage = {
    getJob: jest.fn(async () => ({ id: jobId, playlistUrl, referer: '', title: 'Stream', status: 'queued', autoStart: false })),
    deleteJob: jest.fn(async () => {}),
    createOutput: jest.fn(),
  };
  const platform = {
    storage,
    network: {
      fetch: jest.fn(async (url, options) => {
        requests.push({ url, credentials: options.credentials });
        if (options.credentials === 'include') throw new TypeError('CORS rejected credentialed request.');
        return {
          status: 200,
          ok: true,
          url,
          headers: { get: name => name === 'content-length' ? String(body.byteLength) : 'application/vnd.apple.mpegurl' },
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
        };
      }),
    },
    permissions: { ensureHostAccess: jest.fn(async () => true) },
    tabs: { getCurrentId: jest.fn(async () => 42) },
    rules: { available: false },
    lifecycle: { onPageClose: handler => pageCloseHandlers.push(handler) },
    downloads: { download: jest.fn() },
  };

  document.body.innerHTML = `
    <div id="sourceLabel"></div>
    <section id="variantSection" class="hidden"><select id="variantSelect"></select></section>
    <select id="concurrencySelect"><option value="4" selected>4</option></select>
    <input id="filenameInput" type="text">
    <button id="startBtn" disabled></button>
    <button id="cancelBtn" class="hidden"></button>
    <progress id="progress" class="hidden"></progress>
    <div id="progressLabel"></div>
    <div id="status"></div>`;
  window.GUDHlsCore = Core;
  window.GUDHlsPlatform = platform;

  try {
    vm.runInNewContext(pageSource, {
      window,
      document,
      location: { href: `chrome-extension://test/hls.html?job=${jobId}`, origin: 'chrome-extension://test', search: `?job=${jobId}` },
      URL,
      URLSearchParams,
      AbortController,
      TextDecoder,
      Blob,
      setTimeout,
      clearTimeout,
      console,
    });

    await waitFor(() => document.getElementById('status').textContent.includes('finished segments are ready'));
    expect(requests).toEqual([
      { url: playlistUrl, credentials: 'include' },
      { url: playlistUrl, credentials: 'omit' },
    ]);
    expect(pageCloseHandlers).toHaveLength(1);

    pageCloseHandlers[0]();
    await waitFor(() => storage.deleteJob.mock.calls.length === 1);
    expect(storage.deleteJob).toHaveBeenCalledWith(jobId);
  } finally {
    delete window.GUDHlsCore;
    delete window.GUDHlsPlatform;
    document.body.innerHTML = '';
  }
});

test('does not retry HTTP 403 without credentials', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174002';
  const playlistUrl = 'https://cdn.example/index.m3u8?sig=private';
  const requests = [];
  const storage = {
    getJob: jest.fn(async () => ({ id: jobId, playlistUrl, referer: '', title: 'Stream', status: 'queued' })),
    deleteJob: jest.fn(async () => {}),
    createOutput: jest.fn(),
  };
  const platform = {
    storage,
    network: {
      fetch: jest.fn(async (url, options) => {
        requests.push(options.credentials);
        return { status: 403, ok: false, url, headers: { get: () => null }, body: { cancel: jest.fn() } };
      }),
    },
    permissions: { ensureHostAccess: jest.fn(async () => true) },
    tabs: { getCurrentId: jest.fn(async () => 42) },
    rules: { available: false },
    lifecycle: { onPageClose: jest.fn() },
    downloads: { download: jest.fn() },
  };

  document.body.innerHTML = `
    <div id="sourceLabel"></div>
    <section id="variantSection" class="hidden"><select id="variantSelect"></select></section>
    <select id="concurrencySelect"><option value="4" selected>4</option></select>
    <input id="filenameInput" type="text">
    <button id="startBtn" disabled></button>
    <button id="cancelBtn" class="hidden"></button>
    <progress id="progress" class="hidden"></progress>
    <div id="progressLabel"></div>
    <div id="status"></div>`;
  window.GUDHlsCore = Core;
  window.GUDHlsPlatform = platform;

  try {
    vm.runInNewContext(pageSource, {
      window,
      document,
      location: { href: `chrome-extension://test/hls.html?job=${jobId}`, origin: 'chrome-extension://test', search: `?job=${jobId}` },
      URL,
      URLSearchParams,
      AbortController,
      TextDecoder,
      Blob,
      setTimeout,
      clearTimeout,
      console,
    });

    await waitFor(() => document.getElementById('status').textContent.includes('access was denied'));
    expect(requests).toEqual(['include']);
    expect(storage.deleteJob).toHaveBeenCalledWith(jobId);
  } finally {
    delete window.GUDHlsCore;
    delete window.GUDHlsPlatform;
    document.body.innerHTML = '';
  }
});

test('blocks redirects before they can reach another host and does not retry a distinguishable redirect rejection', async () => {
  const jobId = '123e4567-e89b-12d3-a456-426614174003';
  const playlistUrl = 'https://cdn.example/index.m3u8?sig=private';
  const requests = [];
  const storage = {
    getJob: jest.fn(async () => ({ id: jobId, playlistUrl, referer: '', title: 'Stream', status: 'queued' })),
    deleteJob: jest.fn(async () => {}),
    createOutput: jest.fn(),
  };
  const platform = {
    storage,
    network: {
      fetch: jest.fn(async (url, options) => {
        requests.push({ url, credentials: options.credentials, redirect: options.redirect });
        throw new TypeError('Redirect mode is error and the URL was redirected.');
      }),
    },
    permissions: { ensureHostAccess: jest.fn(async () => true) },
    tabs: { getCurrentId: jest.fn(async () => 42) },
    rules: { available: false },
    lifecycle: { onPageClose: jest.fn() },
    downloads: { download: jest.fn() },
  };

  document.body.innerHTML = `
    <div id="sourceLabel"></div>
    <section id="variantSection" class="hidden"><select id="variantSelect"></select></section>
    <select id="concurrencySelect"><option value="4" selected>4</option></select>
    <input id="filenameInput" type="text">
    <button id="startBtn" disabled></button>
    <button id="cancelBtn" class="hidden"></button>
    <progress id="progress" class="hidden"></progress>
    <div id="progressLabel"></div>
    <div id="status"></div>`;
  window.GUDHlsCore = Core;
  window.GUDHlsPlatform = platform;

  try {
    vm.runInNewContext(pageSource, {
      window,
      document,
      location: { href: `chrome-extension://test/hls.html?job=${jobId}`, origin: 'chrome-extension://test', search: `?job=${jobId}` },
      URL,
      URLSearchParams,
      AbortController,
      TextDecoder,
      Blob,
      setTimeout,
      clearTimeout,
      console,
    });

    await waitFor(() => document.getElementById('status').textContent.includes('redirects are not supported'));
    expect(requests).toEqual([{ url: playlistUrl, credentials: 'include', redirect: 'error' }]);
    expect(storage.deleteJob).toHaveBeenCalledWith(jobId);
  } finally {
    delete window.GUDHlsCore;
    delete window.GUDHlsPlatform;
    document.body.innerHTML = '';
  }
});
