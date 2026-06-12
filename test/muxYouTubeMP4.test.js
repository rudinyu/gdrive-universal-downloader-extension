// Unit tests for muxYouTubeMP4 — exercises the function with synthetic minimal MP4 buffers.
// Extracts the function from popup.js via a thin wrapper rather than a full DOM environment.

const fs = require('fs');
const vm = require('vm');

// ── Minimal MP4 builder ───────────────────────────────────────────────────────
function u32(n) {
  const b = Buffer.alloc(4); b.writeUInt32BE(n); return b;
}
function box(type, ...children) {
  const data   = Buffer.concat(children.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + data.length);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data]);
}

// Minimal ftyp: size(4) + 'ftyp'(4) + major(4) + ver(4) + compat(4) = 20 bytes
function mkFtyp() { return box('ftyp', Buffer.from('isom'), u32(0), Buffer.from('isom')); }

// Minimal stco with given offsets
function mkStco(offsets) {
  const data = Buffer.concat([u32(0), u32(offsets.length), ...offsets.map(u32)]);
  return box('stco', data);
}

// Minimal stbl containing only stco (enough for the muxer to navigate to)
function mkStbl(offsets) { return box('stbl', mkStco(offsets)); }

// Minimal vmhd/smhd (media handler box, needed for minf structure)
function mkVmhd() { return box('vmhd', Buffer.alloc(8)); }
function mkSmhd() { return box('smhd', Buffer.alloc(8)); }

// Build a minimal trak box
// handlerType: 'vide' or 'soun'
// chunkOffsets: array of stco offset values
function mkTrak(handlerType, chunkOffsets) {
  const tkhd = box('tkhd', Buffer.alloc(92 - 8)); // full-size tkhd v0
  const mdhd = box('mdhd', Buffer.alloc(24));
  const hdlr = box('hdlr', Buffer.concat([u32(0), Buffer.from(handlerType), Buffer.alloc(12)]));
  const handler = handlerType === 'vide' ? mkVmhd() : mkSmhd();
  const stbl    = mkStbl(chunkOffsets);
  const minf    = box('minf', handler, stbl);
  const mdia    = box('mdia', mdhd, hdlr, minf);
  return box('trak', tkhd, mdia);
}

// Build a complete single-track MP4
// The mdat payload bytes are placed after ftyp + moov.
function mkMp4(handlerType, mdatPayload) {
  const payload    = Buffer.isBuffer(mdatPayload) ? mdatPayload : Buffer.from(mdatPayload);
  const ftypBytes  = mkFtyp();                      // 20 bytes
  const mvhd       = box('mvhd', Buffer.alloc(100 - 8)); // 100 bytes
  // We need a placeholder trak first to know moov size, then rebuild with real offsets.
  // moov = 8 + mvhd(100) + trak(?).
  // mdat starts at ftypBytes.length + moovSize
  // chunk data starts at mdat start + 8 (mdat header)

  // First, compute sizes
  const placeholderTrak = mkTrak(handlerType, [0]); // offset 0, will fix later
  const placeholderMoov = box('moov', mvhd, placeholderTrak);
  const mdatStart       = ftypBytes.length + placeholderMoov.length;
  const chunkOffset     = mdatStart + 8; // after mdat size+type header

  // Rebuild with correct offset
  const realTrak = mkTrak(handlerType, [chunkOffset]);
  const realMoov = box('moov', mvhd, realTrak);
  const mdat     = box('mdat', payload);

  return Buffer.concat([ftypBytes, realMoov, mdat]);
}

// ── Extract muxYouTubeMP4 from popup.js ───────────────────────────────────────
// Slice out just the function body so we don't have to run the entire popup.js DOM environment.
const popupSrc = fs.readFileSync(require('path').join(__dirname, '../popup.js'), 'utf8');
const fnStart  = popupSrc.indexOf('\nfunction muxYouTubeMP4(');
const fnEnd    = popupSrc.indexOf('\n// ── YouTube quality picker', fnStart);
if (fnStart === -1) throw new Error('Cannot locate muxYouTubeMP4 in popup.js');
if (fnEnd   === -1) throw new Error('Cannot locate end-sentinel for muxYouTubeMP4 in popup.js');
const fnSrc    = popupSrc.slice(fnStart, fnEnd).trim();
const muxYouTubeMP4 = vm.runInThisContext(`(function(){ ${fnSrc}; return muxYouTubeMP4; })()`);

// ── Helpers ───────────────────────────────────────────────────────────────────
function readU32(buf, off) { return buf.readUInt32BE(off); }
function boxType(buf, off) { return buf.slice(off + 4, off + 8).toString('ascii'); }

function findBox(buf, start, end, type) {
  let pos = start;
  while (pos + 8 <= end) {
    const size = readU32(buf, pos);
    if (size < 8) break;
    if (boxType(buf, pos) === type) return { offset: pos, size };
    pos += size;
  }
  return null;
}

function findNested(buf, ...path) {
  // Start with offset=-8 so the first iteration searches from 0 (not 8)
  let cur = { offset: -8, size: buf.length + 8 }; // sentinel: first search covers [0, buf.length)
  for (const t of path) {
    const found = findBox(buf, cur.offset + 8, cur.offset + cur.size, t);
    if (!found) return null;
    cur = found;
  }
  return cur;
}

function readStcoOffsets(buf, stco) {
  const count = readU32(buf, stco.offset + 12); // version/flags(4) then count(4)
  const offsets = [];
  for (let i = 0; i < count; i++) offsets.push(readU32(buf, stco.offset + 16 + i * 4));
  return offsets;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('muxYouTubeMP4', () => {
  const VIDEO_DATA = Buffer.from('VIDEO_PAYLOAD_DATA');
  const AUDIO_DATA = Buffer.from('AUDIO_PAYLOAD_DATA');

  // Node.js Buffer.concat uses a shared pool for small buffers — byteOffset may be non-zero.
  // Slice the underlying ArrayBuffer to get a standalone copy the muxer can index from 0.
  const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

  let videoBuf, audioBuf, muxed, muxedBuf;

  beforeAll(() => {
    videoBuf = mkMp4('vide', VIDEO_DATA);
    audioBuf = mkMp4('soun', AUDIO_DATA);
    muxed    = muxYouTubeMP4(toAB(videoBuf), toAB(audioBuf));
    muxedBuf = Buffer.from(muxed);
  });

  test('function is exported and produces a non-empty ArrayBuffer', () => {
    expect(typeof muxYouTubeMP4).toBe('function');
    expect(muxed?.constructor?.name).toBe('ArrayBuffer'); // cross-realm safe
    expect(muxed.byteLength).toBeGreaterThan(0);
  });

  test('output starts with ftyp box from video', () => {
    expect(boxType(muxedBuf, 0)).toBe('ftyp');
    const ftyp = findBox(muxedBuf, 0, muxedBuf.length, 'ftyp');
    expect(ftyp.size).toBe(20); // same as input ftyp
  });

  test('output contains a moov box after ftyp', () => {
    const ftyp = findBox(muxedBuf, 0, muxedBuf.length, 'ftyp');
    expect(boxType(muxedBuf, ftyp.size)).toBe('moov');
  });

  test('output moov contains two trak boxes', () => {
    const moov   = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    let pos = moov.offset + 8, count = 0;
    while (pos < moov.offset + moov.size) {
      const size = readU32(muxedBuf, pos);
      if (size < 8) break;
      if (boxType(muxedBuf, pos) === 'trak') count++;
      pos += size;
    }
    expect(count).toBe(2);
  });

  test('output ends with video mdat payload', () => {
    const moov = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    const vMdat = findBox(muxedBuf, moov.offset + moov.size, muxedBuf.length, 'mdat');
    expect(vMdat).not.toBeNull();
    const payload = muxedBuf.slice(vMdat.offset + 8, vMdat.offset + vMdat.size);
    expect(payload.toString()).toBe('VIDEO_PAYLOAD_DATA');
  });

  test('output ends with audio mdat payload after video mdat', () => {
    const moov  = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    const vMdat = findBox(muxedBuf, moov.offset + moov.size, muxedBuf.length, 'mdat');
    const aMdat = findBox(muxedBuf, vMdat.offset + vMdat.size, muxedBuf.length, 'mdat');
    expect(aMdat).not.toBeNull();
    const payload = muxedBuf.slice(aMdat.offset + 8, aMdat.offset + aMdat.size);
    expect(payload.toString()).toBe('AUDIO_PAYLOAD_DATA');
  });

  test('video track stco offsets point inside video mdat', () => {
    const moov  = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    const stco  = findNested(muxedBuf, 'moov', 'trak', 'mdia', 'minf', 'stbl', 'stco');
    expect(stco).not.toBeNull();
    const [offset] = readStcoOffsets(muxedBuf, stco);

    const vMdat = findBox(muxedBuf, moov.offset + moov.size, muxedBuf.length, 'mdat');
    // chunk offset must fall within video mdat data range
    expect(offset).toBeGreaterThanOrEqual(vMdat.offset + 8);
    expect(offset).toBeLessThan(vMdat.offset + vMdat.size);
  });

  test('audio track stco offsets point inside audio mdat', () => {
    const moov  = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    const vMdat = findBox(muxedBuf, moov.offset + moov.size, muxedBuf.length, 'mdat');
    const aMdat = findBox(muxedBuf, vMdat.offset + vMdat.size, muxedBuf.length, 'mdat');

    // Find second trak (audio)
    let pos = moov.offset + 8, trakCount = 0;
    let audioTrakOffset = -1, audioTrakSize = 0;
    while (pos < moov.offset + moov.size) {
      const size = readU32(muxedBuf, pos);
      if (size < 8) break;
      if (boxType(muxedBuf, pos) === 'trak') {
        trakCount++;
        if (trakCount === 2) { audioTrakOffset = pos; audioTrakSize = size; break; }
      }
      pos += size;
    }
    expect(audioTrakOffset).toBeGreaterThan(0);

    // Find stco within audio trak
    const mdia = findBox(muxedBuf, audioTrakOffset + 8, audioTrakOffset + audioTrakSize, 'mdia');
    expect(mdia).not.toBeNull();
    const minf = findBox(muxedBuf, mdia.offset + 8, mdia.offset + mdia.size, 'minf');
    expect(minf).not.toBeNull();
    const stbl = findBox(muxedBuf, minf.offset + 8, minf.offset + minf.size, 'stbl');
    expect(stbl).not.toBeNull();
    const stco = findBox(muxedBuf, stbl.offset + 8, stbl.offset + stbl.size, 'stco');
    expect(stco).not.toBeNull();
    const [offset] = readStcoOffsets(muxedBuf, stco);

    expect(offset).toBeGreaterThanOrEqual(aMdat.offset + 8);
    expect(offset).toBeLessThan(aMdat.offset + aMdat.size);
  });

  test('throws on fragmented video (moof before moov — realistic fMP4 layout)', () => {
    // Real fMP4 streams have moof boxes interleaved with or before moov
    const moofBox   = box('moof', Buffer.alloc(8));
    const fragVideo = Buffer.concat([moofBox, videoBuf]); // moof precedes moov
    expect(() => muxYouTubeMP4(toAB(fragVideo), toAB(audioBuf))).toThrow(/fragmented/i);
  });

  test('throws on fragmented video (moof after moov)', () => {
    const moofBox   = box('moof', Buffer.alloc(8));
    const fragVideo = Buffer.concat([videoBuf, moofBox]);
    expect(() => muxYouTubeMP4(toAB(fragVideo), toAB(audioBuf))).toThrow(/fragmented/i);
  });

  test('throws on fragmented audio', () => {
    const moofBox   = box('moof', Buffer.alloc(8));
    const fragAudio = Buffer.concat([moofBox, audioBuf]);
    expect(() => muxYouTubeMP4(toAB(videoBuf), toAB(fragAudio))).toThrow(/fragmented/i);
  });

  test('total output size equals ftyp + new moov + both mdats', () => {
    const vBoxes = { ftyp: findBox(videoBuf, 0, videoBuf.length, 'ftyp'), mdat: findBox(videoBuf, 0, videoBuf.length, 'mdat') };
    const aBoxes = { mdat: findBox(audioBuf, 0, audioBuf.length, 'mdat') };
    const moov = findBox(muxedBuf, 0, muxedBuf.length, 'moov');
    const expected = vBoxes.ftyp.size + moov.size + vBoxes.mdat.size + aBoxes.mdat.size;
    expect(muxedBuf.length).toBe(expected);
  });
});
