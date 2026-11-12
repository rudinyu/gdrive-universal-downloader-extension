const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder, TextEncoder } = require('util');
const Core = require('../hls-core.js');

const fixture = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/hls-smoke.ts')));
const separateAvFixtureDir = path.join(__dirname, 'fixtures/separate-av');
const muxSource = fs.readFileSync(path.join(__dirname, '../lib/mux.js'), 'utf8');

const createMux = () => {
  const context = { window: {}, console, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder };
  vm.runInNewContext(muxSource, context);
  return context.muxjs;
};

const mediaText = (body, ending = '#EXT-X-ENDLIST') => [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:4',
  body,
  ending,
].filter(Boolean).join('\n');

const makeBox = (type, payload = new Uint8Array()) => {
  const box = new Uint8Array(8 + payload.byteLength);
  new DataView(box.buffer).setUint32(0, box.byteLength, false);
  box.set([...type].map(char => char.charCodeAt(0)), 4);
  box.set(payload, 8);
  return box;
};

const concat = arrays => {
  const size = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const array of arrays) { result.set(array, offset); offset += array.byteLength; }
  return result;
};

const readChildBoxes = (bytes, parent) => {
  const children = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = parent.offset + parent.headerSize;
  const end = parent.offset + parent.size;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      size = view.getUint32(offset + 8, false) * 0x100000000 + view.getUint32(offset + 12, false);
      headerSize = 16;
    }
    if (!size || offset + size > end) throw new Error(`Malformed fixture box ${type}.`);
    children.push({ type, offset, size, headerSize });
    offset += size;
  }
  if (offset !== end) throw new Error('Malformed fixture box children.');
  return children;
};

const readSeparateFragmentInfo = bytes => {
  const top = Core.readMp4Boxes(bytes);
  const moof = top.find(box => box.type === 'moof');
  const moofChildren = readChildBoxes(bytes, moof);
  const mfhd = moofChildren.find(box => box.type === 'mfhd');
  const traf = moofChildren.find(box => box.type === 'traf');
  const trafChildren = readChildBoxes(bytes, traf);
  const tfhd = trafChildren.find(box => box.type === 'tfhd');
  const tfdt = trafChildren.find(box => box.type === 'tfdt');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[tfdt.offset + tfdt.headerSize];
  const decodeTime = version === 1
    ? view.getUint32(tfdt.offset + tfdt.headerSize + 4, false) * 0x100000000 + view.getUint32(tfdt.offset + tfdt.headerSize + 8, false)
    : view.getUint32(tfdt.offset + tfdt.headerSize + 4, false);
  return {
    trackId: view.getUint32(tfhd.offset + tfhd.headerSize + 4, false),
    sequence: view.getUint32(mfhd.offset + mfhd.headerSize + 4, false),
    decodeTime,
  };
};

const setSeparateFragmentDecodeTime = (bytes, decodeTime) => {
  const moof = Core.readMp4Boxes(bytes).find(box => box.type === 'moof');
  const traf = readChildBoxes(bytes, moof).find(box => box.type === 'traf');
  const tfdt = readChildBoxes(bytes, traf).find(box => box.type === 'tfdt');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[tfdt.offset + tfdt.headerSize];
  if (version === 1) {
    view.setUint32(tfdt.offset + tfdt.headerSize + 4, Math.floor(decodeTime / 0x100000000), false);
    view.setUint32(tfdt.offset + tfdt.headerSize + 8, decodeTime >>> 0, false);
  } else {
    view.setUint32(tfdt.offset + tfdt.headerSize + 4, decodeTime, false);
  }
  return bytes;
};

const makeFmp4Init = () => {
  const avcEntry = makeBox('avc1', new Uint8Array(78));
  const stsdPayload = new Uint8Array(8 + avcEntry.byteLength);
  new DataView(stsdPayload.buffer).setUint32(4, 1, false);
  stsdPayload.set(avcEntry, 8);
  const stsd = makeBox('stsd', stsdPayload);
  const stbl = makeBox('stbl', stsd);
  const minf = makeBox('minf', stbl);
  const mdia = makeBox('mdia', minf);
  const trak = makeBox('trak', mdia);
  return concat([makeBox('ftyp', new Uint8Array(8)), makeBox('moov', trak)]);
};

describe('HLS playlist parsing and support boundaries', () => {
  test('sanitizes a custom output name and always returns an MP4 filename', () => {
    expect(Core.sanitizeOutputFilename('../secrets/../../My <video>:?.mov')).toBe('My _video___.mp4');
    expect(Core.sanitizeOutputFilename('   ', 'Fallback name')).toBe('Fallback name.mp4');
    expect(Core.sanitizeOutputFilename('Already.Named.MP4')).toBe('Already.Named.mp4');
  });

  test('parses quoted attributes and resolves relative master variants against the playlist URL', () => {
    const variants = Core.parseMasterPlaylist([
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
      'video/720/index.m3u8?sig=one',
    ].join('\n'), 'https://media.example/hls/master.m3u8?session=secret');

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      url: 'https://media.example/hls/video/720/index.m3u8?sig=one',
      bandwidth: 2500000,
      resolution: '1280x720',
      codecs: 'avc1.64001f,mp4a.40.2',
      separateAudio: false,
    });
    expect(Core.variantUnsupportedReason(variants[0])).toBe('');
  });

  test('accepts a UTF-8 BOM before master and media playlist headers', () => {
    const variants = Core.parseMasterPlaylist('\uFEFF#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nmedia/index.m3u8',
      'https://media.example/master.m3u8');
    const playlist = Core.parseMediaPlaylist('\uFEFF#EXTM3U\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST',
      variants[0].url);

    expect(variants).toHaveLength(1);
    expect(playlist.segments).toHaveLength(1);
    expect(playlist.segments[0].url).toBe('https://media.example/media/segment.ts');
  });

  test('supports a single external AVC/AAC audio rendition', () => {
    const variants = Core.parseMasterPlaylist([
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"',
      'video/720.m3u8',
    ].join('\n'), 'https://media.example/master.m3u8');

    expect(variants[0].separateAudio).toBe(true);
    expect(variants[0].audioRendition).toMatchObject({
      url: 'https://media.example/audio/en.m3u8',
      name: 'English',
      default: true,
    });
    expect(Core.variantUnsupportedReason(variants[0])).toBe('');
  });

  test('selects a sole AUTOSELECT external audio rendition when DEFAULT is NO', () => {
    const [variant] = Core.parseMasterPlaylist([
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=NO,AUTOSELECT=YES,URI="audio/audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio"',
      'video/video.m3u8',
    ].join('\n'), 'https://media.example/master.m3u8');

    expect(variant).toMatchObject({
      separateAudio: true,
      audioRendition: {
        url: 'https://media.example/audio/audio.m3u8',
        default: false,
        autoselect: true,
      },
    });
    expect(Core.variantUnsupportedReason(variant)).toBe('');
  });

  test('selects an unambiguous default in-band rendition when external alternatives are also listed', () => {
    const variants = Core.parseMasterPlaylist([
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Muxed",DEFAULT=YES',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1800000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"',
      'video/720.m3u8',
    ].join('\n'), 'https://media.example/master.m3u8');

    expect(variants[0]).toMatchObject({ separateAudio: false, audioGroupError: '', audioRendition: null });
    expect(Core.variantUnsupportedReason(variants[0])).toBe('');
  });

  test('allows a video-only fallback for ambiguous mixed audio groups without an explicit default', () => {
    const [variant] = Core.parseMasterPlaylist([
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Muxed"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio/en.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1800000,CODECS="avc1.64001f,mp4a.40.2",AUDIO="audio"',
      'video/720.m3u8',
    ].join('\n'), 'https://media.example/master.m3u8');

    expect(variant.audioGroupError).toBe('audio rendition selection is ambiguous');
    expect(variant.audioRendition).toBeNull();
    expect(Core.variantUnsupportedReason(variant)).toBe('');
  });

  test('rejects codecs outside the supported AVC and AAC MP4 output path', () => {
    expect(Core.variantUnsupportedReason({ codecs: 'hvc1.1.6.L93.B0,mp4a.40.2' })).toMatch(/codec is not supported/i);
    expect(Core.variantUnsupportedReason({ codecs: 'avc1.4d401f,mp4a.40.2' })).toBe('');
  });

  test('keeps external audio codec metadata optional while retaining non-AVC video checks', () => {
    expect(Core.variantUnsupportedReason({ codecs: 'avc1.4d401f,ac-3', separateAudio: true })).toBe('');
    expect(Core.variantUnsupportedReason({ codecs: '', separateAudio: true })).toBe('');
    expect(Core.variantUnsupportedReason({ codecs: 'hvc1.1.6.L93.B0,ec-3', separateAudio: true }))
      .toMatch(/video codec is not supported/i);
  });

  test('resolves relative media and initialization URLs and parses explicit plus implicit byte ranges', () => {
    const playlist = Core.parseMediaPlaylist(mediaText([
      '#EXT-X-MAP:URI="container.mp4",BYTERANGE="16@0"',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:188@0',
      'segments.ts?token=one',
      '#EXTINF:4.0,',
      '#EXT-X-BYTERANGE:188',
      'segments.ts?token=one',
    ].join('\n')), 'https://media.example/path/index.m3u8');

    expect(playlist.container).toBe('fmp4');
    expect(playlist.segments[0]).toMatchObject({
      url: 'https://media.example/path/segments.ts?token=one',
      range: { offset: 0, length: 188 },
      map: { url: 'https://media.example/path/container.mp4', range: { offset: 0, length: 16 } },
    });
    expect(playlist.segments[1].range).toEqual({ offset: 188, length: 188 });
  });

  test('rejects an implicit byte range without a preceding range for the same resource', () => {
    expect(() => Core.parseMediaPlaylist(mediaText([
      '#EXTINF:4.0,', '#EXT-X-BYTERANGE:188', 'segment.bin',
    ].join('\n')), 'https://media.example/index.m3u8')).toThrow(/byte range/i);
  });

  test.each([
    ['AES-128', 'HLS_ENCRYPTED'],
    ['SAMPLE-AES', 'HLS_ENCRYPTED'],
  ])('rejects %s encryption', (method, code) => {
    try {
      Core.parseMediaPlaylist(mediaText([
        `#EXT-X-KEY:METHOD=${method},URI="key.bin"`,
        '#EXTINF:4.0,', 'segment.ts',
      ].join('\n')), 'https://media.example/index.m3u8');
      throw new Error('expected parser rejection');
    } catch (error) {
      expect(error.code).toBe(code);
      expect(error.message).not.toContain('key.bin');
    }
  });

  test('rejects live playlists and playlists with missing media segments', () => {
    expect(() => Core.parseMediaPlaylist(mediaText('#EXTINF:4.0,\nsegment.ts', ''), 'https://media.example/index.m3u8'))
      .toThrow(/live HLS playlists/i);
    expect(() => Core.parseMediaPlaylist(mediaText('#EXTINF:4.0,'), 'https://media.example/index.m3u8'))
      .toThrow(/incomplete segment/i);
  });

  test('rejects unsupported private network and credential-bearing stream URLs', () => {
    expect(() => Core.resolveHttpUrl('http://192.168.1.10/index.m3u8', 'https://page.example/'))
      .toThrow(/private or local network/i);
    expect(() => Core.resolveHttpUrl('https://user:password@media.example/index.m3u8'))
      .toThrow(/unsupported.*URL scheme/i);
  });
});

describe('bounded HLS media processing', () => {
  test.each([403, 404])('does not retry HTTP %s and does not expose signed URL tokens', async status => {
    const fetchImpl = jest.fn(async () => ({
      status,
      ok: false,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    }));
    const waitFn = jest.fn(async () => {});
    let caught;
    try {
      await Core.requestWithRetry('https://cdn.example/list.m3u8?token=private-token', {}, { fetchImpl, waitFn });
    } catch (error) { caught = error; }

    expect(caught).toMatchObject({ code: 'HLS_HTTP' });
    expect(caught.message).toContain(`HTTP ${status}`);
    expect(caught.message).not.toContain('private-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  test('rejects visible 3xx responses without retrying', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 302,
      ok: false,
      headers: { get: () => null },
      body: { cancel: jest.fn() },
    }));
    const waitFn = jest.fn(async () => {});

    await expect(Core.requestWithRetry('https://cdn.example/list.m3u8', {}, { fetchImpl, waitFn }))
      .rejects.toMatchObject({ code: 'HLS_REDIRECT', message: 'HLS redirects are not supported by this downloader.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  test('retries 429 and server errors with bounded delay before succeeding', async () => {
    const response = status => ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: name => name === 'retry-after' ? '0' : null },
      body: { cancel: jest.fn() },
    });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const waitFn = jest.fn(async () => {});
    const result = await Core.requestWithRetry('https://cdn.example/list.m3u8', {}, {
      fetchImpl,
      waitFn,
      processResponse: async value => value.status,
    });

    expect(result).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waitFn).toHaveBeenCalledTimes(2);
  });

  test('retries a transient network failure and stops once a request succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce({ status: 200, ok: true, headers: { get: () => null } });
    const waitFn = jest.fn(async () => {});
    const result = await Core.requestWithRetry('https://cdn.example/list.m3u8', {}, {
      fetchImpl,
      waitFn,
      processResponse: async value => value.status,
    });

    expect(result).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waitFn).toHaveBeenCalledTimes(1);
  });

  test('surfaces denied host access without retrying or starting a network request', async () => {
    const fetchImpl = jest.fn();
    const waitFn = jest.fn(async () => {});
    const ensureRefererRule = jest.fn(async () => {
      throw Object.assign(new Error('Extension host access is not granted for this media host.'), { code: 'HLS_PERMISSION' });
    });

    await expect(Core.requestWithRetry('https://cdn.example/list.m3u8', {}, {
      fetchImpl,
      waitFn,
      ensureRefererRule,
    })).rejects.toMatchObject({ code: 'HLS_PERMISSION' });

    expect(ensureRefererRule).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(waitFn).not.toHaveBeenCalled();
  });

  test('converts a real H.264/AAC transport-stream fixture into valid fragmented MP4 chunks', async () => {
    const muxjs = createMux();
    const chunks = [];
    const result = await Core.downloadMediaPlaylist({
      container: 'ts',
      segments: [{ url: 'https://cdn.example/smoke.ts', duration: 9, range: null, map: null, discontinuity: false }],
    }, {
      muxjs,
      fetchBytes: async () => fixture.slice(),
      appendChunk: async bytes => chunks.push(bytes.slice()),
    });

    expect(result).toMatchObject({ container: 'ts', segments: 1, mediaSegments: 1 });
    expect(Core.validateFmp4Output(chunks)).toMatchObject({ bytes: result.bytes, mediaSegments: 1 });
    const output = new Uint8Array(result.bytes);
    let cursor = 0;
    for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.byteLength; }
    const boxes = muxjs.mp4.tools.inspect(output);
    expect(boxes[0].type).toBe('ftyp');
    expect(boxes[1].type).toBe('moov');
    expect(boxes.filter(box => box.type === 'moof').length).toBeGreaterThan(0);
    expect(boxes.filter(box => box.type === 'mdat').length).toBeGreaterThan(0);
    expect(boxes[1].boxes.filter(box => box.type === 'trak')).toHaveLength(2);
  });

  test('rebases TS discontinuities onto the accumulated output timeline', async () => {
    const muxjs = createMux();
    const chunks = [];
    await Core.downloadMediaPlaylist({
      container: 'ts',
      segments: [
        { url: 'https://cdn.example/first.ts', duration: 9, range: null, map: null, discontinuity: false },
        { url: 'https://cdn.example/second.ts', duration: 9, range: null, map: null, discontinuity: true },
      ],
    }, {
      muxjs,
      fetchBytes: async () => fixture.slice(),
      appendChunk: async bytes => chunks.push(bytes.slice()),
    });

    const output = concat(chunks);
    const boxes = muxjs.mp4.tools.inspect(output);
    const decodeTimes = [];
    const walk = values => values.forEach(box => {
      if (box.type === 'tfdt') decodeTimes.push(box.baseMediaDecodeTime);
      if (box.boxes) walk(box.boxes);
    });
    walk(boxes);
    expect(decodeTimes).toContain(810000);
  });

  test('processes a 236-segment TS playlist with bounded ordered chunk writes', async () => {
    const muxjs = createMux();
    const segments = Array.from({ length: 236 }, (_, index) => ({
      url: `https://cdn.example/segment-${index}.ts`, duration: 9, range: null, map: null,
      discontinuity: index > 0,
    }));
    let fetchedSegments = 0;
    let outputBytes = 0;
    const outputOffsets = [];
    const result = await Core.downloadMediaPlaylist({ container: 'ts', segments }, {
      muxjs,
      fetchBytes: async () => { fetchedSegments++; return fixture.slice(); },
      appendChunk: async (bytes, offset) => {
        expect(offset).toBe(outputBytes);
        outputOffsets.push(offset);
        outputBytes += bytes.byteLength;
      },
    });

    expect(result).toMatchObject({ container: 'ts', segments: 236 });
    expect(fetchedSegments).toBe(236);
    expect(outputOffsets.length).toBeGreaterThan(236);
    expect(outputBytes).toBe(result.bytes);
    expect(outputBytes).toBeLessThan(Core.LIMITS.MAX_OUTPUT_BYTES);
  });

  test('assembles a mapped 59-segment fMP4 playlist into one ordered MP4', async () => {
    const muxjs = createMux();
    const fmp4Segments = new Map();
    let initSegment = null;
    const playlistText = [
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:9',
      '#EXT-X-MAP:URI="init.mp4"',
      ...Array.from({ length: 59 }, (_, index) => [`#EXTINF:9.0,`, `video${index + 1}.m4s`]).flat(),
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = Core.parseMediaPlaylist(playlistText, 'https://cdn.example/hls/index.m3u8');
    expect(playlist.container).toBe('fmp4');
    expect(playlist.segments).toHaveLength(59);

    for (let index = 0; index < playlist.segments.length; index++) {
      const transmuxer = new muxjs.mp4.Transmuxer({ baseMediaDecodeTime: index * 810000 });
      const events = [];
      transmuxer.on('data', segment => events.push(segment));
      transmuxer.push(fixture.slice());
      transmuxer.flush();
      expect(events).toHaveLength(1);
      if (index === 0) initSegment = new Uint8Array(events[0].initSegment).slice();
      expect(new Uint8Array(events[0].initSegment)).toEqual(initSegment);
      fmp4Segments.set(playlist.segments[index].url, new Uint8Array(events[0].data).slice());
    }

    const output = [];
    const result = await Core.downloadMediaPlaylist(playlist, {
      fetchBytes: async url => url === playlist.segments[0].map.url ? initSegment.slice() : fmp4Segments.get(url).slice(),
      appendChunk: async bytes => output.push(bytes.slice()),
    });
    const inspected = muxjs.mp4.tools.inspect(concat(output));
    const trackCount = inspected.find(box => box.type === 'moov').boxes.filter(box => box.type === 'trak').length;
    const decodeTimes = [];
    const walk = values => values.forEach(box => {
      if (box.type === 'tfdt') decodeTimes.push(box.baseMediaDecodeTime);
      if (box.boxes) walk(box.boxes);
    });
    walk(inspected);

    expect(result).toMatchObject({ container: 'fmp4', segments: 59, mediaSegments: 59 });
    expect(output).toHaveLength(60);
    expect(trackCount).toBe(2);
    expect(decodeTimes).toContain(58 * 810000);
    expect(decodeTimes.some(time => time >= 58 * 396900)).toBe(true);
  });

  test('normalizes size-zero initialization and media boxes before concatenating fMP4 output', async () => {
    const muxjs = createMux();
    const transmuxer = new muxjs.mp4.Transmuxer();
    const events = [];
    transmuxer.on('data', segment => events.push(segment));
    transmuxer.push(fixture.slice());
    transmuxer.flush();
    const init = new Uint8Array(events[0].initSegment).slice();
    const media = new Uint8Array(events[0].data).slice();
    const initMoov = Core.readMp4Boxes(init).find(box => box.type === 'moov');
    const mediaMdat = Core.readMp4Boxes(media).find(box => box.type === 'mdat');
    new DataView(init.buffer, init.byteOffset, init.byteLength).setUint32(initMoov.offset, 0, false);
    new DataView(media.buffer, media.byteOffset, media.byteLength).setUint32(mediaMdat.offset, 0, false);
    const playlist = Core.parseMediaPlaylist([
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:1,', 'one.m4s',
      '#EXTINF:1,', 'two.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n'), 'https://cdn.example/index.m3u8');
    const output = [];

    await Core.downloadMediaPlaylist(playlist, {
      fetchBytes: async url => url.endsWith('init.mp4') ? init.slice() : media.slice(),
      appendChunk: async bytes => output.push(bytes.slice()),
    });

    const combinedBoxes = Core.readMp4Boxes(concat(output));
    expect(new DataView(output[0].buffer, output[0].byteOffset, output[0].byteLength).getUint32(initMoov.offset, false))
      .toBe(initMoov.size);
    expect(output.slice(1).every(chunk => {
      const mdat = Core.readMp4Boxes(chunk).find(box => box.type === 'mdat');
      return mdat && new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(mdat.offset, false) === mdat.size;
    })).toBe(true);
    expect(combinedBoxes.map(box => box.type)).toEqual(['ftyp', 'moov', 'moof', 'mdat', 'moof', 'mdat']);
  });

  test('combines independent AVC video and AAC fMP4 playlists with distinct remapped tracks', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const requests = [];
    let active = 0;
    let maxActive = 0;
    const fetchBytes = async url => {
      requests.push(url);
      const filename = new URL(url).pathname.split('/').pop();
      const bytes = readFixture(filename);
      if (filename.endsWith('.m4s')) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, filename.includes('-00') ? 3 : 1));
        active--;
      }
      return bytes;
    };
    const output = [];
    const progress = [];
    let offset = 0;
    const result = await Core.downloadSeparateFmp4Playlists(video, audio, {
      concurrency: 3,
      maxOutputBytes: Core.LIMITS.MAX_OPFS_OUTPUT_BYTES,
      fetchBytes,
      appendChunk: async (bytes, byteOffset) => {
        expect(byteOffset).toBe(offset);
        output.push(bytes.slice());
        offset += bytes.byteLength;
      },
      onProgress: event => progress.push(event),
    });
    const trackIds = output.slice(1).map(chunk => readSeparateFragmentInfo(chunk).trackId);
    const fragments = output.slice(1).map(readSeparateFragmentInfo);
    const times = fragments.map(fragment => fragment.decodeTime / (fragment.trackId === 1 ? 15360 : 48000));
    const initTracks = Core.getMp4SampleEntryTypes(output[0]);
    const initTop = Core.readMp4Boxes(output[0]);
    const moov = initTop.find(box => box.type === 'moov');
    const moovChildren = readChildBoxes(output[0], moov);
    const mvhd = moovChildren.find(box => box.type === 'mvhd');
    const tracks = moovChildren.filter(box => box.type === 'trak');
    const initView = new DataView(output[0].buffer, output[0].byteOffset, output[0].byteLength);
    const initTrackIds = tracks.map(track => {
      const tkhd = readChildBoxes(output[0], track).find(box => box.type === 'tkhd');
      return new DataView(output[0].buffer, output[0].byteOffset, output[0].byteLength)
        .getUint32(tkhd.offset + tkhd.headerSize + 12, false);
    });

    expect(video.segments).toHaveLength(3);
    expect(audio.segments).toHaveLength(4);
    expect(requests.filter(url => url.endsWith('.m4s'))).toHaveLength(7);
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(result).toMatchObject({ container: 'fmp4-av', segments: 7, mediaSegments: 7, videoSegments: 3, audioSegments: 4 });
    expect(progress).toHaveLength(7);
    expect(progress.at(-1)).toMatchObject({ completed: 7, total: 7 });
    expect(initTrackIds).toEqual([1, 2]);
    expect(initTracks.sort()).toEqual(['avc1', 'mp4a']);
    expect(initView.getUint32(mvhd.offset + mvhd.headerSize + 12, false)).toBe(48000);
    expect(trackIds).toEqual([1, 2, 1, 2, 1, 2, 2]);
    expect(fragments.map(fragment => fragment.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(times).toEqual([...times].sort((left, right) => left - right));
    expect(output).toHaveLength(8);
    expect(offset).toBe(result.bytes);
  });

  test('normalizes a size-zero separate-rendition mdat and keeps later fragments visible', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const output = [];

    await Core.downloadSeparateFmp4Playlists(video, audio, {
      fetchBytes: async url => {
        const filename = new URL(url).pathname.split('/').pop();
        const bytes = readFixture(filename);
        if (filename === 'audio-00.m4s') {
          const mdat = Core.readMp4Boxes(bytes).find(box => box.type === 'mdat');
          new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(mdat.offset, 0, false);
        }
        return bytes;
      },
      appendChunk: async bytes => output.push(bytes.slice()),
    });

    expect(Core.readMp4Boxes(concat(output)).filter(box => box.type === 'mdat')).toHaveLength(7);
    expect(output.slice(1).every(chunk => {
      const mdat = Core.readMp4Boxes(chunk).find(box => box.type === 'mdat');
      return mdat && new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(mdat.offset, false) === mdat.size;
    })).toBe(true);
  });

  test.each([
    ['audio', true],
    ['video', false],
  ])('rejects an out-of-range %s trun data offset with rendition-specific fallback', async (rendition, shouldFallback) => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const corruptedFile = `${rendition}-00.m4s`;
    let caught;

    try {
      await Core.downloadSeparateFmp4Playlists(video, audio, {
        fetchBytes: async url => {
          const filename = new URL(url).pathname.split('/').pop();
          const bytes = readFixture(filename);
          if (filename === corruptedFile) {
            const top = Core.readMp4Boxes(bytes);
            const moof = top.find(box => box.type === 'moof');
            const moofChildren = readChildBoxes(bytes, moof);
            const traf = moofChildren.find(box => box.type === 'traf');
            const trun = readChildBoxes(bytes, traf).find(box => box.type === 'trun');
            new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
              .setInt32(trun.offset + trun.headerSize + 8, 0x7fffffff, false);
          }
          return bytes;
        },
        appendChunk: jest.fn(async () => {}),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'HLS_UNSUPPORTED' });
    if (shouldFallback) expect(caught.hlsAudioFallback).toBe(true);
    else expect(caught.hlsAudioFallback).toBeUndefined();
  });

  test('marks audio-rendition transfer errors as video-only fallback candidates', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');

    await expect(Core.downloadSeparateFmp4Playlists(video, audio, {
      fetchBytes: async url => {
        if (url.endsWith('audio-00.m4s')) throw new Core.HlsError('Audio segment unavailable.', 'HLS_NETWORK');
        return readFixture(new URL(url).pathname.split('/').pop());
      },
      appendChunk: jest.fn(async () => {}),
    })).rejects.toMatchObject({ code: 'HLS_NETWORK', hlsAudioFallback: true });
  });

  test('never marks video-rendition transfer errors as audio fallback candidates', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    let error;

    try {
      await Core.downloadSeparateFmp4Playlists(video, audio, {
        fetchBytes: async url => {
          if (url.endsWith('video-00.m4s')) throw new Core.HlsError('Video segment unavailable.', 'HLS_NETWORK');
          return readFixture(new URL(url).pathname.split('/').pop());
        },
        appendChunk: jest.fn(async () => {}),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'HLS_NETWORK' });
    expect(error.hlsAudioFallback).toBeUndefined();
  });

  test('never marks output storage failures as audio fallback candidates', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    let writes = 0;

    try {
      await Core.downloadSeparateFmp4Playlists(video, audio, {
        fetchBytes: async url => readFixture(new URL(url).pathname.split('/').pop()),
        appendChunk: async () => {
          writes++;
          if (writes === 1) throw new Core.HlsError('Browser storage is full.', 'HLS_QUOTA');
        },
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'HLS_QUOTA' });
      expect(error.hlsAudioFallback).toBeUndefined();
      return;
    }
    throw new Error('Expected a storage quota failure.');
  });

  test('keeps separate-audio fragments in global decode-time order with concurrency one', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const audioStartTimes = [0, 24000, 72000, 168000];
    let active = 0;
    let maxActive = 0;
    const output = [];
    let offset = 0;
    await Core.downloadSeparateFmp4Playlists(video, audio, {
      concurrency: 1,
      fetchBytes: async url => {
        const filename = new URL(url).pathname.split('/').pop();
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--;
        const bytes = readFixture(filename);
        if (/^audio-\d+\.m4s$/.test(filename)) {
          const index = Number(filename.match(/audio-(\d+)\.m4s$/)[1]);
          setSeparateFragmentDecodeTime(bytes, audioStartTimes[index]);
        }
        return bytes;
      },
      appendChunk: async (bytes, byteOffset) => {
        expect(byteOffset).toBe(offset);
        output.push(bytes.slice());
        offset += bytes.byteLength;
      },
    });

    const fragments = output.slice(1).map(readSeparateFragmentInfo);
    const seconds = fragments.map(fragment => fragment.decodeTime / (fragment.trackId === 1 ? 15360 : 48000));
    expect(maxActive).toBe(1);
    expect(fragments.map(fragment => fragment.trackId)).toEqual([1, 2, 2, 1, 2, 1, 2]);
    expect(seconds).toEqual([...seconds].sort((left, right) => left - right));
    const perTrack = new Map([[1, []], [2, []]]);
    fragments.forEach(fragment => perTrack.get(fragment.trackId).push(fragment.decodeTime));
    expect(perTrack.get(1)).toEqual([...perTrack.get(1)].sort((left, right) => left - right));
    expect(perTrack.get(2)).toEqual([...perTrack.get(2)].sort((left, right) => left - right));
  });

  test('rejects unsupported separate-track fragment offsets without writing a media fragment', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const unsupportedVideoFragment = readFixture('video-00.m4s');
    const moof = Core.readMp4Boxes(unsupportedVideoFragment).find(box => box.type === 'moof');
    const traf = readChildBoxes(unsupportedVideoFragment, moof).find(box => box.type === 'traf');
    const tfhd = readChildBoxes(unsupportedVideoFragment, traf).find(box => box.type === 'tfhd');
    const view = new DataView(unsupportedVideoFragment.buffer, unsupportedVideoFragment.byteOffset, unsupportedVideoFragment.byteLength);
    const flagsOffset = tfhd.offset + tfhd.headerSize;
    view.setUint32(flagsOffset, view.getUint32(flagsOffset, false) & ~0x020000, false);
    const appendChunk = jest.fn(async () => {});

    await expect(Core.downloadSeparateFmp4Playlists(video, audio, {
      fetchBytes: async url => {
        const filename = new URL(url).pathname.split('/').pop();
        if (filename === 'video-00.m4s') return unsupportedVideoFragment;
        return readFixture(filename);
      },
      appendChunk,
    })).rejects.toMatchObject({ code: 'HLS_UNSUPPORTED' });

    expect(appendChunk).toHaveBeenCalledTimes(1);
    expect(appendChunk.mock.calls[0][0]).toEqual(expect.any(Uint8Array));
  });

  test('cancels separate-track downloads before fetching initialization data', async () => {
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const controller = new AbortController();
    controller.abort();
    const fetchBytes = jest.fn();
    const appendChunk = jest.fn();

    await expect(Core.downloadSeparateFmp4Playlists(video, audio, {
      signal: controller.signal,
      fetchBytes,
      appendChunk,
    })).rejects.toMatchObject({ code: 'HLS_CANCELLED' });

    expect(fetchBytes).not.toHaveBeenCalled();
    expect(appendChunk).not.toHaveBeenCalled();
  });

  test('enforces a separate-track output cap before fetching media segments', async () => {
    const readFixture = name => new Uint8Array(fs.readFileSync(path.join(separateAvFixtureDir, name)));
    const video = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'video.m3u8'), 'utf8'),
      'https://fixture.example/video.m3u8');
    const audio = Core.parseMediaPlaylist(fs.readFileSync(path.join(separateAvFixtureDir, 'audio.m3u8'), 'utf8'),
      'https://fixture.example/audio.m3u8');
    const requests = [];
    const appendChunk = jest.fn();

    await expect(Core.downloadSeparateFmp4Playlists(video, audio, {
      maxOutputBytes: 100,
      fetchBytes: async url => {
        requests.push(url);
        return readFixture(new URL(url).pathname.split('/').pop());
      },
      appendChunk,
    })).rejects.toMatchObject({ code: 'HLS_LIMIT' });

    expect(requests).toHaveLength(2);
    expect(requests.every(url => url.endsWith('-init.mp4'))).toBe(true);
    expect(appendChunk).not.toHaveBeenCalled();
  });

  test('downloads fMP4 segments in bounded batches and preserves playlist order', async () => {
    const init = makeFmp4Init();
    const fragment = concat([
      makeBox('moof', new Uint8Array([0, 0, 0, 0])),
      makeBox('mdat', new Uint8Array([1, 2, 3, 4])),
    ]);
    const segments = Array.from({ length: 8 }, (_, index) => ({
      url: `https://cdn.example/${index}.m4s`, duration: 1, range: null,
      map: { url: 'https://cdn.example/init.mp4', range: null }, discontinuity: false,
    }));
    let active = 0;
    let maximumActive = 0;
    const fetchedOrder = [];
    const output = [];
    const result = await Core.downloadMediaPlaylist({ container: 'fmp4', segments }, {
      concurrency: 2,
      fetchBytes: async url => {
        if (url.endsWith('init.mp4')) return init.slice();
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise(resolve => setTimeout(resolve, Number(url.match(/(\d+)\.m4s$/)[1]) % 2 ? 5 : 1));
        fetchedOrder.push(Number(url.match(/(\d+)\.m4s$/)[1]));
        active--;
        return fragment.slice();
      },
      appendChunk: async bytes => output.push(bytes.slice()),
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(output).toHaveLength(9);
    expect(result.segments).toBe(8);
    expect(fetchedOrder).toHaveLength(8);
    expect(Core.validateFmp4Output(output).mediaSegments).toBe(8);
  });

  test('rejects fMP4 discontinuities instead of concatenating incompatible timelines', async () => {
    const map = { url: 'https://cdn.example/init.mp4', range: null };
    await expect(Core.downloadMediaPlaylist({
      container: 'fmp4',
      segments: [{ url: 'https://cdn.example/0.m4s', duration: 1, range: null, map, discontinuity: true }],
    }, { fetchBytes: jest.fn(), appendChunk: jest.fn() })).rejects.toMatchObject({ code: 'HLS_UNSUPPORTED' });
  });

  test('rejects cancellation before reading segment bytes', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchBytes = jest.fn();
    await expect(Core.downloadMediaPlaylist({ container: 'ts', segments: [{ url: 'https://cdn.example/a.ts', duration: 1 }] }, {
      signal: controller.signal, fetchBytes, appendChunk: jest.fn(), muxjs: createMux(),
    })).rejects.toMatchObject({ code: 'HLS_CANCELLED' });
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  test('stops after cancellation during a bounded segment batch', async () => {
    const controller = new AbortController();
    const fetchBytes = jest.fn(async () => {
      controller.abort();
      return fixture.slice();
    });
    const appendChunk = jest.fn();
    const segments = Array.from({ length: 3 }, (_, index) => ({
      url: `https://cdn.example/${index}.ts`, duration: 9, discontinuity: false,
    }));

    await expect(Core.downloadMediaPlaylist({ container: 'ts', segments }, {
      signal: controller.signal,
      fetchBytes,
      appendChunk,
      muxjs: createMux(),
    })).rejects.toMatchObject({ code: 'HLS_CANCELLED' });
    expect(fetchBytes).toHaveBeenCalledTimes(3);
    expect(appendChunk).not.toHaveBeenCalled();
  });
});
