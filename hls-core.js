// HLS parsing and bounded media processing. This file intentionally avoids
// retaining playlist URLs in error messages or progress events.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GUDHlsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LIMITS = Object.freeze({
    MAX_PLAYLIST_BYTES: 2 * 1024 * 1024,
    MAX_VARIANTS: 40,
    MAX_SEGMENTS: 6000,
    MAX_SEGMENT_BYTES: 8 * 1024 * 1024,
    MAX_OUTPUT_BYTES: 192 * 1024 * 1024,
    MAX_OPFS_OUTPUT_BYTES: 4 * 1024 * 1024 * 1024,
    CONCURRENCY: 4,
  });

  class HlsError extends Error {
    constructor(message, code = 'HLS_UNSUPPORTED') {
      super(message);
      this.name = 'HlsError';
      this.code = code;
    }
  }

  const fail = (message, code) => { throw new HlsError(message, code); };

  const sanitizeOutputFilename = (value, fallback = 'video') => {
    const cleanBase = input => {
      let name = (input ?? '').toString().split(/[\\/]/).pop() || '';
      name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
      name = name.replace(/\.[a-z0-9]{1,10}$/i, '').replace(/\.+$/, '').slice(0, 150).trim();
      return name;
    };
    const base = cleanBase(value) || cleanBase(fallback) || 'video';
    return `${base}.mp4`;
  };

  const parseAttributeList = (source) => {
    const result = Object.create(null);
    let i = 0;
    while (i < source.length) {
      while (source[i] === ',' || /\s/.test(source[i] || '')) i++;
      if (i >= source.length) break;
      const nameStart = i;
      while (i < source.length && source[i] !== '=' && source[i] !== ',') i++;
      if (source[i] !== '=') fail('Malformed HLS attribute list.', 'HLS_MALFORMED');
      const name = source.slice(nameStart, i).trim().toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(name) || Object.prototype.hasOwnProperty.call(result, name)) {
        fail('Malformed HLS attribute list.', 'HLS_MALFORMED');
      }
      i++;
      let value = '';
      if (source[i] === '"') {
        i++;
        let closed = false;
        while (i < source.length) {
          if (source[i] === '"') { closed = true; i++; break; }
          value += source[i++];
        }
        if (!closed) fail('Malformed quoted HLS attribute.', 'HLS_MALFORMED');
        while (i < source.length && /\s/.test(source[i])) i++;
        if (i < source.length && source[i] !== ',') fail('Malformed HLS attribute separator.', 'HLS_MALFORMED');
      } else {
        const valueStart = i;
        while (i < source.length && source[i] !== ',') i++;
        value = source.slice(valueStart, i).trim();
      }
      result[name] = value;
      if (source[i] === ',') i++;
    }
    return result;
  };

  const isPrivateOrLocalHost = (hostname) => {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host.includes(':')) {
      return host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd') ||
        host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb') ||
        host.startsWith('ff') || host.startsWith('::ffff:');
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      const octets = host.split('.').map(Number);
      if (octets.some(value => value > 255)) return true;
      const [a, b] = octets;
      return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) || (a >= 224);
    }
    return !host.includes('.');
  };

  const resolveHttpUrl = (value, baseUrl, label = 'HLS resource') => {
    let parsed;
    try { parsed = new URL(value, baseUrl); } catch { fail(`Invalid ${label} URL.`, 'HLS_MALFORMED'); }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
      fail(`Unsupported ${label} URL scheme.`, 'HLS_UNSUPPORTED');
    }
    if (isPrivateOrLocalHost(parsed.hostname)) {
      fail(`Private or local network ${label}s are not supported.`, 'HLS_UNSUPPORTED');
    }
    parsed.hash = '';
    return parsed.href;
  };

  const stripPlaylistBom = text => typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;

  const parseMasterPlaylist = (text, baseUrl) => {
    text = stripPlaylistBom(text);
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U')) fail('Playlist is malformed.', 'HLS_MALFORMED');
    if (text.length > LIMITS.MAX_PLAYLIST_BYTES) fail('Playlist is too large.', 'HLS_LIMIT');
    const lines = text.split(/\r?\n/).map(line => line.trim());
    const audioGroups = new Map();
    const variants = [];
    let pendingStream = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-SESSION-KEY:')) fail('Encrypted or DRM-protected HLS is not supported.', 'HLS_ENCRYPTED');
      if (line.startsWith('#EXT-X-DEFINE:')) fail('HLS variable substitution is not supported.', 'HLS_UNSUPPORTED');
      if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
        if (attrs.TYPE === 'AUDIO' && attrs['GROUP-ID']) {
          const group = audioGroups.get(attrs['GROUP-ID']) || [];
          const hasUri = !!attrs.URI;
          group.push({
            hasUri,
            url: hasUri ? resolveHttpUrl(attrs.URI, baseUrl, 'audio rendition') : '',
            default: attrs.DEFAULT === 'YES',
            autoselect: attrs.AUTOSELECT === 'YES',
            name: attrs.NAME || '',
            language: attrs.LANGUAGE || '',
          });
          audioGroups.set(attrs['GROUP-ID'], group);
        }
      } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
        if (pendingStream) fail('Master playlist has a variant without a URL.', 'HLS_MALFORMED');
        pendingStream = parseAttributeList(line.slice(line.indexOf(':') + 1));
      } else if (line && !line.startsWith('#') && pendingStream) {
        const resolution = /^\d+x\d+$/i.test(pendingStream.RESOLUTION || '') ? pendingStream.RESOLUTION : '';
        variants.push({
          url: resolveHttpUrl(line, baseUrl, 'variant'),
          bandwidth: Number(pendingStream['AVERAGE-BANDWIDTH'] || pendingStream.BANDWIDTH) || 0,
          resolution,
          codecs: pendingStream.CODECS || '',
          audioGroup: pendingStream.AUDIO || '',
          videoGroup: pendingStream.VIDEO || '',
        });
        pendingStream = null;
        if (variants.length > LIMITS.MAX_VARIANTS) fail('Master playlist has too many variants.', 'HLS_LIMIT');
      }
    }
    if (pendingStream) fail('Master playlist has a variant without a URL.', 'HLS_MALFORMED');
    if (!variants.length) fail('Master playlist contains no supported variants.', 'HLS_UNSUPPORTED');

    return variants.map(variant => {
      const group = audioGroups.get(variant.audioGroup) || [];
      let audioRendition = null;
      let audioGroupError = '';
      if (variant.audioGroup && !group.length) {
        audioGroupError = 'referenced audio group is missing';
      } else if (group.length) {
        const defaults = group.filter(item => item.default);
        const inBand = group.filter(item => !item.hasUri);
        const external = group.filter(item => item.hasUri);
        if (defaults.length > 1) {
          audioGroupError = 'audio rendition default is ambiguous';
        } else if (defaults.length === 1) {
          if (defaults[0].hasUri) audioRendition = defaults[0];
        } else if (!external.length) {
          if (inBand.length > 1) audioGroupError = 'in-band audio rendition is ambiguous';
        } else if (!inBand.length && external.length === 1) {
          audioRendition = external[0];
        } else {
          audioGroupError = 'audio rendition selection is ambiguous';
        }
      }
      return {
        ...variant,
        separateAudio: !!audioRendition?.url,
        audioRendition,
        audioGroupError,
        audioName: audioRendition?.name || group.find(item => item.default)?.name || group[0]?.name || '',
      };
    }).sort((a, b) => b.bandwidth - a.bandwidth);
  };

  const parseByteRange = (value, implicitOffset) => {
    const match = /^(\d+)(?:@(\d+))?$/.exec((value || '').trim());
    if (!match) fail('Malformed HLS byte range.', 'HLS_MALFORMED');
    const length = Number(match[1]);
    const offset = match[2] === undefined ? implicitOffset : Number(match[2]);
    if (!Number.isSafeInteger(length) || length <= 0 || length > LIMITS.MAX_SEGMENT_BYTES ||
        !Number.isSafeInteger(offset) || offset < 0 || offset + length > Number.MAX_SAFE_INTEGER) {
      fail('HLS byte range exceeds the supported limit.', 'HLS_LIMIT');
    }
    return { offset, length };
  };

  const parseMediaPlaylist = (text, baseUrl) => {
    text = stripPlaylistBom(text);
    if (typeof text !== 'string' || !text.startsWith('#EXTM3U')) fail('Playlist is malformed.', 'HLS_MALFORMED');
    if (text.length > LIMITS.MAX_PLAYLIST_BYTES) fail('Playlist is too large.', 'HLS_LIMIT');
    const lines = text.split(/\r?\n/).map(line => line.trim());
    const segments = [];
    const implicitRangeOffsets = new Map();
    let targetDuration = null;
    let pendingDuration = null;
    let pendingRange = null;
    let currentMap = null;
    let hasEndList = false;
    let playlistType = '';
    let discontinuity = false;
    const rangeFor = (url, value) => {
      const offset = implicitRangeOffsets.get(url);
      const range = parseByteRange(value, offset);
      implicitRangeOffsets.set(url, range.offset + range.length);
      return range;
    };

    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('#EXT-X-SESSION-KEY:')) fail('Encrypted or DRM-protected HLS is not supported.', 'HLS_ENCRYPTED');
      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
        if (attrs.METHOD !== 'NONE') fail('Encrypted or DRM-protected HLS is not supported.', 'HLS_ENCRYPTED');
      } else if (line.startsWith('#EXT-X-DEFINE:')) {
        fail('HLS variable substitution is not supported.', 'HLS_UNSUPPORTED');
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = Number(line.slice(line.indexOf(':') + 1));
        if (!Number.isFinite(targetDuration) || targetDuration <= 0) fail('Playlist target duration is malformed.', 'HLS_MALFORMED');
      } else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
        playlistType = line.slice(line.indexOf(':') + 1).toUpperCase();
      } else if (line.startsWith('#EXTINF:')) {
        if (pendingDuration !== null) fail('Playlist has a segment without a URL.', 'HLS_MALFORMED');
        pendingDuration = Number(line.slice(line.indexOf(':') + 1).split(',')[0]);
        if (!Number.isFinite(pendingDuration) || pendingDuration <= 0) fail('Playlist segment duration is malformed.', 'HLS_MALFORMED');
      } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
        if (pendingRange) fail('Playlist has multiple byte ranges for one segment.', 'HLS_MALFORMED');
        pendingRange = line.slice(line.indexOf(':') + 1);
      } else if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
        if (!attrs.URI) fail('HLS initialization segment has no URL.', 'HLS_MALFORMED');
        const url = resolveHttpUrl(attrs.URI, baseUrl, 'initialization segment');
        const range = attrs.BYTERANGE ? rangeFor(url, attrs.BYTERANGE) : null;
        currentMap = { url, range };
      } else if (line === '#EXT-X-ENDLIST') {
        hasEndList = true;
      } else if (line === '#EXT-X-DISCONTINUITY') {
        discontinuity = true;
      } else if (line.startsWith('#EXT-X-GAP')) {
        fail('HLS playlists with missing segment gaps are not supported.', 'HLS_UNSUPPORTED');
      } else if (line.startsWith('#EXT-X-PART:') || line.startsWith('#EXT-X-PRELOAD-HINT:') ||
                 line.startsWith('#EXT-X-SERVER-CONTROL:') || line.startsWith('#EXT-X-SKIP:') ||
                 line === '#EXT-X-I-FRAMES-ONLY') {
        fail('Low-latency, delta, or I-frame-only HLS playlists are not supported.', 'HLS_UNSUPPORTED');
      } else if (!line.startsWith('#')) {
        if (pendingDuration === null) fail('Playlist contains a segment URL without EXTINF.', 'HLS_MALFORMED');
        const url = resolveHttpUrl(line, baseUrl, 'segment');
        segments.push({
          url,
          duration: pendingDuration,
          range: pendingRange ? rangeFor(url, pendingRange) : null,
          map: currentMap,
          discontinuity,
        });
        pendingDuration = null;
        pendingRange = null;
        discontinuity = false;
        if (segments.length > LIMITS.MAX_SEGMENTS) fail('Playlist has too many media segments.', 'HLS_LIMIT');
      }
    }

    if (pendingDuration !== null || pendingRange) fail('Playlist ends with an incomplete segment.', 'HLS_MALFORMED');
    if (!segments.length) fail('Media playlist contains no segments.', 'HLS_MALFORMED');
    if (!hasEndList) fail(playlistType === 'EVENT' ? 'Live or unfinished HLS playlists are not supported.' : 'Live HLS playlists are not supported.', 'HLS_LIVE');

    const hasMap = segments.some(segment => segment.map);
    if (hasMap && segments.some(segment => !segment.map)) fail('Playlist mixes fMP4 and transport-stream segments.', 'HLS_UNSUPPORTED');
    return { segments, targetDuration, playlistType, container: hasMap ? 'fmp4' : 'ts' };
  };

  const isTransportStream = (bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 188 || bytes.byteLength % 188 !== 0) return false;
    for (let offset = 0; offset < bytes.byteLength; offset += 188) if (bytes[offset] !== 0x47) return false;
    return true;
  };

  const readMp4Boxes = (bytes) => {
    if (!(bytes instanceof Uint8Array)) return [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const boxes = [];
    let offset = 0;
    while (offset + 8 <= bytes.byteLength) {
      let size = view.getUint32(offset, false);
      const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > bytes.byteLength) return [];
        const high = view.getUint32(offset + 8, false);
        const low = view.getUint32(offset + 12, false);
        if (high > 0x1fffff) return [];
        size = high * 0x100000000 + low;
        headerSize = 16;
      } else if (size === 0) {
        size = bytes.byteLength - offset;
      }
      if (size < headerSize || offset + size > bytes.byteLength) return [];
      boxes.push({ type, offset, size, headerSize });
      offset += size;
    }
    if (offset !== bytes.byteLength) return [];
    return boxes;
  };

  const MP4_CONTAINER_BOXES = new Map([
    ['moov', 0], ['trak', 0], ['mdia', 0], ['minf', 0], ['stbl', 0], ['edts', 0],
    ['dinf', 0], ['mvex', 0], ['moof', 0], ['traf', 0], ['mfra', 0], ['sinf', 0],
    ['schi', 0], ['tref', 0], ['wave', 0], ['meta', 4],
  ]);

  // A size-zero MP4 box extends to the end of its containing byte stream. That
  // is safe while reading one HLS fragment, but not after appending more
  // fragments to the same output. Make every parsed size-zero header explicit
  // before the bytes are copied into the combined file.
  const normalizeMp4BoxSizes = bytes => {
    if (!(bytes instanceof Uint8Array)) fail('MP4 data is malformed.', 'HLS_UNSUPPORTED');
    const top = readMp4Boxes(bytes);
    if (!top.length) fail('MP4 box structure is malformed.', 'HLS_UNSUPPORTED');
    const result = bytes.slice();
    const view = viewOf(result);
    let changed = false;
    const walk = (start, end) => {
      const scope = result.subarray(start, end);
      const boxes = readMp4Boxes(scope);
      if (!boxes.length && end > start) return;
      for (const box of boxes) {
        const offset = start + box.offset;
        if (view.getUint32(offset, false) === 0) {
          if (box.size > 0xffffffff) fail('MP4 box exceeds the supported size limit.', 'HLS_LIMIT');
          view.setUint32(offset, box.size, false);
          changed = true;
        }
        if (!MP4_CONTAINER_BOXES.has(box.type)) continue;
        const childStart = offset + box.headerSize + MP4_CONTAINER_BOXES.get(box.type);
        const childEnd = offset + box.size;
        if (childStart <= childEnd && childEnd <= end) walk(childStart, childEnd);
      }
    };
    walk(0, result.byteLength);
    return changed ? result : bytes;
  };

  const containsFourCC = (bytes, types) => {
    const signatures = types.map(type => Uint8Array.from(type, char => char.charCodeAt(0)));
    for (let i = 4; i + 4 <= bytes.length; i++) {
      for (const signature of signatures) {
        if (bytes[i] === signature[0] && bytes[i + 1] === signature[1] &&
            bytes[i + 2] === signature[2] && bytes[i + 3] === signature[3]) return true;
      }
    }
    return false;
  };

  const childBoxes = (bytes, parent, extraPayloadBytes = 0) => {
    const start = parent.offset + parent.headerSize + extraPayloadBytes;
    const end = parent.offset + parent.size;
    if (start > end || end > bytes.byteLength) return [];
    return readMp4Boxes(bytes.subarray(start, end)).map(box => ({ ...box, offset: box.offset + start }));
  };

  const getMp4SampleEntryTypes = bytes => {
    const top = readMp4Boxes(bytes);
    const moov = top.find(box => box.type === 'moov');
    if (!moov) return [];
    const entries = [];
    for (const trak of childBoxes(bytes, moov).filter(box => box.type === 'trak')) {
      const mdia = childBoxes(bytes, trak).find(box => box.type === 'mdia');
      const minf = mdia && childBoxes(bytes, mdia).find(box => box.type === 'minf');
      const stbl = minf && childBoxes(bytes, minf).find(box => box.type === 'stbl');
      const stsd = stbl && childBoxes(bytes, stbl).find(box => box.type === 'stsd');
      if (stsd) entries.push(...childBoxes(bytes, stsd, 8).map(box => box.type));
    }
    return entries;
  };

  const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readUint64Safe = (bytes, offset) => {
    const view = viewOf(bytes);
    const value = view.getUint32(offset, false) * 0x100000000 + view.getUint32(offset + 4, false);
    if (!Number.isSafeInteger(value)) fail('MP4 timing metadata exceeds the supported integer range.', 'HLS_UNSUPPORTED');
    return value;
  };

  const mp4FullBoxVersion = (bytes, box) => bytes[box.offset + box.headerSize];
  const mp4TrackIdOffset = (bytes, box) => {
    const version = mp4FullBoxVersion(bytes, box);
    if (version === 0) return box.offset + box.headerSize + 12;
    if (version === 1) return box.offset + box.headerSize + 20;
    fail('Unsupported MP4 track-header version.', 'HLS_UNSUPPORTED');
  };

  const getMp4TrackInfo = bytes => {
    const top = readMp4Boxes(bytes);
    const moov = top.find(box => box.type === 'moov');
    if (!moov) return [];
    return childBoxes(bytes, moov).filter(box => box.type === 'trak').map(trak => {
      const trakChildren = childBoxes(bytes, trak);
      const tkhd = trakChildren.find(box => box.type === 'tkhd');
      const mdia = trakChildren.find(box => box.type === 'mdia');
      const mdiaChildren = mdia && childBoxes(bytes, mdia);
      const mdhd = mdiaChildren?.find(box => box.type === 'mdhd');
      const hdlr = mdiaChildren?.find(box => box.type === 'hdlr');
      const minf = mdiaChildren?.find(box => box.type === 'minf');
      const stbl = minf && childBoxes(bytes, minf).find(box => box.type === 'stbl');
      const stsd = stbl && childBoxes(bytes, stbl).find(box => box.type === 'stsd');
      if (!tkhd || !mdhd || !hdlr || !stsd || stsd.size < stsd.headerSize + 8) return null;
      const tkhdTrackIdOffset = mp4TrackIdOffset(bytes, tkhd);
      const mdhdVersion = mp4FullBoxVersion(bytes, mdhd);
      if (mdhdVersion !== 0 && mdhdVersion !== 1) fail('Unsupported MP4 media-header version.', 'HLS_UNSUPPORTED');
      const timescaleOffset = mdhd.offset + mdhd.headerSize + (mdhdVersion === 1 ? 20 : 12);
      if (timescaleOffset + 4 > mdhd.offset + mdhd.size) fail('MP4 media header is malformed.', 'HLS_UNSUPPORTED');
      const hdlrOffset = hdlr.offset + hdlr.headerSize + 8;
      const sampleEntries = childBoxes(bytes, stsd, 8).map(box => box.type);
      return {
        trak,
        tkhd,
        trackId: viewOf(bytes).getUint32(tkhdTrackIdOffset, false),
        handler: String.fromCharCode(bytes[hdlrOffset], bytes[hdlrOffset + 1], bytes[hdlrOffset + 2], bytes[hdlrOffset + 3]),
        timescale: viewOf(bytes).getUint32(timescaleOffset, false),
        sampleEntries,
      };
    }).filter(Boolean);
  };

  const copyBox = (bytes, box) => bytes.slice(box.offset, box.offset + box.size);
  const concatBytes = arrays => {
    const total = arrays.reduce((size, array) => size + array.byteLength, 0);
    if (!Number.isSafeInteger(total) || total > 0xffffffff) fail('MP4 initialization data is too large.', 'HLS_LIMIT');
    const result = new Uint8Array(total);
    let offset = 0;
    for (const array of arrays) { result.set(array, offset); offset += array.byteLength; }
    return result;
  };

  const makeMp4Box = (type, payload) => {
    const size = payload.byteLength + 8;
    if (size > 0xffffffff) fail('MP4 initialization data is too large.', 'HLS_LIMIT');
    const result = new Uint8Array(size);
    const view = viewOf(result);
    view.setUint32(0, size, false);
    for (let i = 0; i < 4; i++) result[4 + i] = type.charCodeAt(i);
    result.set(payload, 8);
    return result;
  };

  const patchBoxUint32 = (boxBytes, offset, value) => {
    if (offset < 0 || offset + 4 > boxBytes.byteLength || !Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      fail('MP4 track metadata is malformed.', 'HLS_UNSUPPORTED');
    }
    viewOf(boxBytes).setUint32(offset, value, false);
  };

  const readMovieTimescale = (bytes, moov) => {
    const mvhd = childBoxes(bytes, moov).find(box => box.type === 'mvhd');
    if (!mvhd) fail('MP4 initialization segment has no movie header.', 'HLS_UNSUPPORTED');
    const version = mp4FullBoxVersion(bytes, mvhd);
    if (version !== 0 && version !== 1) fail('Unsupported MP4 movie-header version.', 'HLS_UNSUPPORTED');
    const offset = mvhd.offset + mvhd.headerSize + (version === 1 ? 20 : 12);
    if (offset + 4 > mvhd.offset + mvhd.size) fail('MP4 movie header is malformed.', 'HLS_UNSUPPORTED');
    const timescale = viewOf(bytes).getUint32(offset, false);
    if (!timescale) fail('MP4 movie timescale is invalid.', 'HLS_UNSUPPORTED');
    return { mvhd, timescale };
  };

  const scaleMovieDuration = (duration, fromTimescale, toTimescale) => {
    if (duration === 0xffffffff) return duration;
    if (!Number.isSafeInteger(duration) || duration < 0 || !fromTimescale || !toTimescale) {
      fail('MP4 edit duration exceeds the supported range.', 'HLS_UNSUPPORTED');
    }
    const numerator = BigInt(duration) * BigInt(toTimescale);
    const denominator = BigInt(fromTimescale);
    const scaled = (numerator + denominator / 2n) / denominator;
    if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) fail('MP4 edit duration exceeds the supported range.', 'HLS_UNSUPPORTED');
    return Number(scaled);
  };

  const rescaleTrackMovieDurations = (trackBytes, movieTimescale, sourceMovieTimescale) => {
    if (movieTimescale === sourceMovieTimescale) return;
    const top = readMp4Boxes(trackBytes);
    const trak = top.find(box => box.type === 'trak');
    if (!trak) fail('MP4 track metadata is malformed.', 'HLS_UNSUPPORTED');
    const children = childBoxes(trackBytes, trak);
    const tkhd = children.find(box => box.type === 'tkhd');
    const edits = children.filter(box => box.type === 'edts');
    if (!tkhd || edits.length > 1) fail('MP4 track timing metadata is unsupported.', 'HLS_UNSUPPORTED');
    const tkhdVersion = mp4FullBoxVersion(trackBytes, tkhd);
    if (tkhdVersion !== 0 && tkhdVersion !== 1) fail('Unsupported MP4 track-header version.', 'HLS_UNSUPPORTED');
    const tkhdDurationOffset = tkhd.offset + tkhd.headerSize + (tkhdVersion === 1 ? 28 : 20);
    if (tkhdDurationOffset + (tkhdVersion === 1 ? 8 : 4) > tkhd.offset + tkhd.size) {
      fail('MP4 track header is malformed.', 'HLS_UNSUPPORTED');
    }
    const view = viewOf(trackBytes);
    const sentinel = tkhdVersion === 1 && view.getUint32(tkhdDurationOffset, false) === 0xffffffff &&
      view.getUint32(tkhdDurationOffset + 4, false) === 0xffffffff;
    if (!sentinel) {
      const duration = tkhdVersion === 1
        ? readUint64Safe(trackBytes, tkhdDurationOffset)
        : view.getUint32(tkhdDurationOffset, false);
      const scaled = scaleMovieDuration(duration, sourceMovieTimescale, movieTimescale);
      if (tkhdVersion === 1) {
        view.setUint32(tkhdDurationOffset, Math.floor(scaled / 0x100000000), false);
        view.setUint32(tkhdDurationOffset + 4, scaled >>> 0, false);
      } else {
        if (scaled > 0xffffffff) fail('MP4 track duration exceeds the supported range.', 'HLS_UNSUPPORTED');
        view.setUint32(tkhdDurationOffset, scaled, false);
      }
    }
    for (const edts of edits) {
      const editBoxes = childBoxes(trackBytes, edts);
      if (editBoxes.length !== 1 || editBoxes[0].type !== 'elst') {
        fail('Separate rendition edit lists use unsupported MP4 boxes.', 'HLS_UNSUPPORTED');
      }
      const elst = editBoxes[0];
      const version = mp4FullBoxVersion(trackBytes, elst);
      if (version !== 0 && version !== 1) fail('Unsupported MP4 edit-list version.', 'HLS_UNSUPPORTED');
      const countOffset = elst.offset + elst.headerSize + 4;
      if (countOffset + 4 > elst.offset + elst.size) fail('MP4 edit list is malformed.', 'HLS_UNSUPPORTED');
      const count = view.getUint32(countOffset, false);
      const entrySize = version === 1 ? 20 : 12;
      const entriesStart = countOffset + 4;
      if (entriesStart + count * entrySize !== elst.offset + elst.size) fail('MP4 edit list is malformed.', 'HLS_UNSUPPORTED');
      for (let index = 0; index < count; index++) {
        const durationOffset = entriesStart + index * entrySize;
        const isUnknownDuration = version === 1 && view.getUint32(durationOffset, false) === 0xffffffff &&
          view.getUint32(durationOffset + 4, false) === 0xffffffff;
        if (isUnknownDuration) continue;
        const duration = version === 1 ? readUint64Safe(trackBytes, durationOffset) : view.getUint32(durationOffset, false);
        const scaled = scaleMovieDuration(duration, sourceMovieTimescale, movieTimescale);
        if (version === 1) {
          view.setUint32(durationOffset, Math.floor(scaled / 0x100000000), false);
          view.setUint32(durationOffset + 4, scaled >>> 0, false);
        } else {
          if (scaled > 0xffffffff) fail('MP4 edit duration exceeds the supported range.', 'HLS_UNSUPPORTED');
          view.setUint32(durationOffset, scaled, false);
        }
      }
    }
  };

  const patchTrackBox = (bytes, track, newTrackId, sourceMovieTimescale, movieTimescale) => {
    const copied = copyBox(bytes, track.trak);
    const offset = mp4TrackIdOffset(bytes, track.tkhd) - track.trak.offset;
    patchBoxUint32(copied, offset, newTrackId);
    if (sourceMovieTimescale && movieTimescale) {
      rescaleTrackMovieDurations(copied, movieTimescale, sourceMovieTimescale);
    }
    return copied;
  };

  const readTrackMovieDuration = trackBytes => {
    const trak = readMp4Boxes(trackBytes).find(box => box.type === 'trak');
    const tkhd = trak && childBoxes(trackBytes, trak).find(box => box.type === 'tkhd');
    if (!tkhd) fail('MP4 track timing metadata is malformed.', 'HLS_UNSUPPORTED');
    const version = mp4FullBoxVersion(trackBytes, tkhd);
    if (version !== 0 && version !== 1) fail('Unsupported MP4 track-header version.', 'HLS_UNSUPPORTED');
    const offset = tkhd.offset + tkhd.headerSize + (version === 1 ? 28 : 20);
    if (offset + (version === 1 ? 8 : 4) > tkhd.offset + tkhd.size) fail('MP4 track header is malformed.', 'HLS_UNSUPPORTED');
    if (version === 1) {
      const view = viewOf(trackBytes);
      if (view.getUint32(offset, false) === 0xffffffff && view.getUint32(offset + 4, false) === 0xffffffff) return null;
      return readUint64Safe(trackBytes, offset);
    }
    const duration = viewOf(trackBytes).getUint32(offset, false);
    return duration === 0xffffffff ? null : duration;
  };

  const greatestCommonDivisor = (left, right) => {
    while (right) [left, right] = [right, left % right];
    return left;
  };

  const patchMovieHeader = (bytes, movieHeader, movieTimescale, duration) => {
    const copied = copyBox(bytes, movieHeader);
    const version = mp4FullBoxVersion(bytes, movieHeader);
    if (version !== 0 && version !== 1) fail('Unsupported MP4 movie-header version.', 'HLS_UNSUPPORTED');
    const timescaleOffset = movieHeader.headerSize + (version === 1 ? 20 : 12);
    const durationOffset = movieHeader.headerSize + (version === 1 ? 24 : 16);
    patchBoxUint32(copied, timescaleOffset, movieTimescale);
    if (duration !== null) {
      if (version === 1) {
        viewOf(copied).setUint32(durationOffset, Math.floor(duration / 0x100000000), false);
        viewOf(copied).setUint32(durationOffset + 4, duration >>> 0, false);
      } else {
        if (duration > 0xffffffff) fail('MP4 movie duration exceeds the supported range.', 'HLS_UNSUPPORTED');
        patchBoxUint32(copied, durationOffset, duration);
      }
    }
    return copied;
  };

  const patchTrex = (bytes, trex, oldTrackId, newTrackId) => {
    if (trex.size < trex.headerSize + 24 || viewOf(bytes).getUint32(trex.offset + trex.headerSize + 4, false) !== oldTrackId) {
      fail('MP4 fragment defaults do not match their track.', 'HLS_UNSUPPORTED');
    }
    const copied = copyBox(bytes, trex);
    patchBoxUint32(copied, trex.headerSize + 4, newTrackId);
    return copied;
  };

  const buildCompatibleFmp4Initialization = (videoBytes, audioBytes) => {
    const videoTop = readMp4Boxes(videoBytes);
    const audioTop = readMp4Boxes(audioBytes);
    const videoFtyp = videoTop.find(box => box.type === 'ftyp');
    const audioFtyp = audioTop.find(box => box.type === 'ftyp');
    const videoMoov = videoTop.find(box => box.type === 'moov');
    const audioMoov = audioTop.find(box => box.type === 'moov');
    if (!videoFtyp || !audioFtyp || !videoMoov || !audioMoov ||
        videoTop.filter(box => box.type === 'ftyp').length !== 1 || audioTop.filter(box => box.type === 'ftyp').length !== 1 ||
        videoTop.filter(box => box.type === 'moov').length !== 1 || audioTop.filter(box => box.type === 'moov').length !== 1 ||
        containsFourCC(videoBytes, ['pssh', 'tenc', 'sinf', 'encv', 'enca']) ||
        containsFourCC(audioBytes, ['pssh', 'tenc', 'sinf', 'encv', 'enca'])) {
      fail('Separate audio and video initialization segments must be clear fragmented MP4.', 'HLS_UNSUPPORTED');
    }
    if (childBoxes(videoBytes, videoMoov).filter(box => box.type === 'mvhd').length !== 1 ||
        childBoxes(audioBytes, audioMoov).filter(box => box.type === 'mvhd').length !== 1 ||
        childBoxes(videoBytes, videoMoov).filter(box => box.type === 'mvex').length !== 1 ||
        childBoxes(audioBytes, audioMoov).filter(box => box.type === 'mvex').length !== 1) {
      fail('Separate fMP4 initialization structures are malformed.', 'HLS_UNSUPPORTED');
    }
    const videoTracks = getMp4TrackInfo(videoBytes);
    const audioTracks = getMp4TrackInfo(audioBytes);
    if (videoTracks.length !== 1 || audioTracks.length !== 1 ||
        videoTracks[0].handler !== 'vide' || !videoTracks[0].timescale ||
        !videoTracks[0].sampleEntries.length || !videoTracks[0].sampleEntries.every(type => type === 'avc1' || type === 'avc3') ||
        audioTracks[0].handler !== 'soun' || !audioTracks[0].timescale ||
        !audioTracks[0].sampleEntries.length || !audioTracks[0].sampleEntries.every(type => type === 'mp4a')) {
      fail('Separate renditions must contain one AVC video track and one AAC audio track.', 'HLS_UNSUPPORTED');
    }
    if (childBoxes(videoBytes, videoTracks[0].trak).some(box => box.type === 'tref') ||
        childBoxes(audioBytes, audioTracks[0].trak).some(box => box.type === 'tref')) {
      fail('Separate fMP4 tracks with track references are not supported.', 'HLS_UNSUPPORTED');
    }
    const videoMovie = readMovieTimescale(videoBytes, videoMoov);
    const audioMovie = readMovieTimescale(audioBytes, audioMoov);
    const videoChildren = childBoxes(videoBytes, videoMoov);
    const audioChildren = childBoxes(audioBytes, audioMoov);
    const videoMvex = videoChildren.find(box => box.type === 'mvex');
    const audioMvex = audioChildren.find(box => box.type === 'mvex');
    if (!videoMvex || !audioMvex) fail('Separate fMP4 tracks have no fragment defaults.', 'HLS_UNSUPPORTED');
    const videoTrex = childBoxes(videoBytes, videoMvex).filter(box => box.type === 'trex');
    const audioTrex = childBoxes(audioBytes, audioMvex).filter(box => box.type === 'trex');
    if (videoTrex.length !== 1 || audioTrex.length !== 1) fail('Separate fMP4 tracks have unsupported fragment defaults.', 'HLS_UNSUPPORTED');

    const commonDivisor = greatestCommonDivisor(videoMovie.timescale, audioMovie.timescale);
    const movieTimescale = videoMovie.timescale / commonDivisor * audioMovie.timescale;
    if (!Number.isSafeInteger(movieTimescale) || movieTimescale > 0xffffffff) {
      fail('Separate audio and video movie timescales cannot be combined safely.', 'HLS_UNSUPPORTED');
    }

    const videoTrackId = 1;
    const audioTrackId = 2;
    const videoTrak = patchTrackBox(videoBytes, videoTracks[0], videoTrackId, videoMovie.timescale, movieTimescale);
    const trexBytes = [
      patchTrex(videoBytes, videoTrex[0], videoTracks[0].trackId, videoTrackId),
      patchTrex(audioBytes, audioTrex[0], audioTracks[0].trackId, audioTrackId),
    ];
    const mvexChildren = [...childBoxes(videoBytes, videoMvex), ...childBoxes(audioBytes, audioMvex)];
    if (mvexChildren.some(box => box.type !== 'trex' && box.type !== 'mehd')) {
      fail('Separate fMP4 tracks use unsupported movie-extends boxes.', 'HLS_UNSUPPORTED');
    }
    const mergedMvex = makeMp4Box('mvex', concatBytes(trexBytes));

    const audioTrakForOutput = patchTrackBox(audioBytes, audioTracks[0], audioTrackId, audioMovie.timescale, movieTimescale);
    const trackDurations = [readTrackMovieDuration(videoTrak), readTrackMovieDuration(audioTrakForOutput)].filter(Number.isFinite);
    const movieDuration = trackDurations.length ? Math.max(...trackDurations) : null;
    const copiedMvhd = patchMovieHeader(videoBytes, videoMovie.mvhd, movieTimescale, movieDuration);
    const mvhdOffset = videoMovie.mvhd.headerSize + (mp4FullBoxVersion(videoBytes, videoMovie.mvhd) === 1 ? 108 : 96);
    patchBoxUint32(copiedMvhd, mvhdOffset, 3);
    const mergedMoovChildren = [];
    for (const child of videoChildren) {
      if (child.type === 'trak') mergedMoovChildren.push(videoTrak, audioTrakForOutput);
      else if (child.type === 'mvex') mergedMoovChildren.push(mergedMvex);
      else if (child.type === 'mvhd') mergedMoovChildren.push(copiedMvhd);
      else mergedMoovChildren.push(copyBox(videoBytes, child));
    }
    if (!videoChildren.some(box => box.type === 'trak') || !videoChildren.some(box => box.type === 'mvex')) {
      fail('Video initialization segment has an incomplete movie structure.', 'HLS_UNSUPPORTED');
    }

    const videoFtypPayload = videoBytes.subarray(videoFtyp.offset + videoFtyp.headerSize, videoFtyp.offset + videoFtyp.size);
    const audioFtypPayload = audioBytes.subarray(audioFtyp.offset + audioFtyp.headerSize, audioFtyp.offset + audioFtyp.size);
    if (videoFtypPayload.byteLength < 8 || audioFtypPayload.byteLength < 8 ||
        (videoFtypPayload.byteLength - 8) % 4 || (audioFtypPayload.byteLength - 8) % 4) {
      fail('Separate fMP4 file-type boxes are malformed.', 'HLS_UNSUPPORTED');
    }
    const brands = new Set();
    const videoMajorBrand = String.fromCharCode(...videoFtypPayload.subarray(0, 4));
    brands.add(String.fromCharCode(...audioFtypPayload.subarray(0, 4)));
    for (const payload of [videoFtypPayload, audioFtypPayload]) {
      for (let offset = 8; offset + 4 <= payload.byteLength; offset += 4) {
        brands.add(String.fromCharCode(payload[offset], payload[offset + 1], payload[offset + 2], payload[offset + 3]));
      }
    }
    const videoMajorAndMinor = videoFtypPayload.slice(0, 8);
    const compatible = [...brands].filter(brand => brand !== videoMajorBrand)
      .map(brand => Uint8Array.from(brand, char => char.charCodeAt(0)));
    const mergedFtyp = makeMp4Box('ftyp', concatBytes([videoMajorAndMinor, ...compatible]));
    const mergedMoov = makeMp4Box('moov', concatBytes(mergedMoovChildren));
    const result = concatBytes([mergedFtyp, mergedMoov]);
    const mergedTracks = getMp4TrackInfo(result);
    if (mergedTracks.length !== 2 || mergedTracks[0].trackId !== videoTrackId || mergedTracks[1].trackId !== audioTrackId ||
        !isValidMp4InitializationSegment(result) || !mergedTracks.some(track => track.handler === 'vide' && track.sampleEntries.includes('avc1') || track.handler === 'vide' && track.sampleEntries.includes('avc3')) ||
        !mergedTracks.some(track => track.handler === 'soun' && track.sampleEntries.includes('mp4a'))) {
      fail('Could not combine separate fMP4 tracks into one MP4 initialization segment.', 'HLS_INVALID_OUTPUT');
    }
    return {
      bytes: result,
      videoTrackId,
      audioTrackId,
      sourceVideoTrackId: videoTracks[0].trackId,
      sourceAudioTrackId: audioTracks[0].trackId,
      sourceVideoDefaultSampleSize: readTrexDefaultSampleSize(videoBytes, videoTrex[0], videoTracks[0].trackId),
      sourceAudioDefaultSampleSize: readTrexDefaultSampleSize(audioBytes, audioTrex[0], audioTracks[0].trackId),
      videoTimescale: videoTracks[0].timescale,
      audioTimescale: audioTracks[0].timescale,
    };
  };

  const isValidMp4InitializationSegment = (bytes) => {
    const boxes = readMp4Boxes(bytes);
    const sampleEntries = getMp4SampleEntryTypes(bytes);
    return boxes.length >= 2 && boxes[0].type === 'ftyp' && boxes.some(box => box.type === 'moov') &&
      sampleEntries.length > 0 && sampleEntries.some(type => type === 'avc1' || type === 'avc3') &&
      sampleEntries.every(type => type === 'avc1' || type === 'avc3' || type === 'mp4a') &&
      !containsFourCC(bytes, ['pssh', 'tenc', 'sinf', 'encv', 'enca']);
  };

  const isValidMp4MediaSegment = (bytes) => {
    const boxes = readMp4Boxes(bytes);
    let hasMoof = false;
    let hasMdatAfterMoof = false;
    for (const box of boxes) {
      if (box.type === 'moof') hasMoof = true;
      if (box.type === 'mdat' && hasMoof) hasMdatAfterMoof = true;
    }
    const metadata = boxes.filter(box => box.type !== 'mdat')
      .map(box => bytes.subarray(box.offset, box.offset + box.size));
    return hasMoof && hasMdatAfterMoof && !metadata.some(part => containsFourCC(part, ['pssh', 'tenc', 'sinf', 'encv', 'enca', 'senc']));
  };

  const validateFmp4Output = (chunks, maxBytes = LIMITS.MAX_OUTPUT_BYTES) => {
    if (!Array.isArray(chunks) || chunks.length < 2 || !isValidMp4InitializationSegment(chunks[0])) {
      fail('The playlist did not produce a valid MP4 initialization segment.', 'HLS_INVALID_OUTPUT');
    }
    if (!chunks.slice(1).every(isValidMp4MediaSegment)) {
      fail('The playlist contains an invalid or incompatible MP4 media segment.', 'HLS_INVALID_OUTPUT');
    }
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) fail('Output exceeds the supported size limit.', 'HLS_LIMIT');
    return { bytes: totalBytes, mediaSegments: chunks.length - 1 };
  };

  const createTsTransmuxer = (muxjs) => {
    if (!muxjs?.mp4?.Transmuxer) fail('The local MP4 transmuxer could not be loaded.', 'HLS_TRANSMUXER');
    let initSegment = null;
    let transmuxer;
    const makeTransmuxer = baseDecodeTime => {
      try { return new muxjs.mp4.Transmuxer({ baseMediaDecodeTime: Math.max(0, Math.floor(baseDecodeTime * 90000)) }); }
      catch { fail('Could not initialize the MP4 transmuxer.', 'HLS_TRANSMUXER'); }
    };
    transmuxer = makeTransmuxer(0);

    return {
      push(bytes, baseDecodeTime, discontinuity) {
        if (!isTransportStream(bytes)) fail('A playlist segment is not a supported MPEG transport stream.', 'HLS_UNSUPPORTED');
        if (discontinuity) transmuxer = makeTransmuxer(baseDecodeTime);
        const media = [];
        let eventError = null;
        const onData = (segment) => {
          if (segment?.initSegment?.byteLength) {
            const nextInit = new Uint8Array(segment.initSegment).slice();
            if (initSegment && (initSegment.byteLength !== nextInit.byteLength || initSegment.some((byte, i) => byte !== nextInit[i]))) {
              eventError = new HlsError('Transport-stream codecs changed during the playlist.', 'HLS_UNSUPPORTED');
            } else {
              initSegment = initSegment || nextInit;
            }
          }
          if (segment?.data?.byteLength) media.push(new Uint8Array(segment.data).slice());
        };
        const onError = () => { eventError = new HlsError('A transport-stream segment could not be converted to MP4.', 'HLS_TRANSMUXER'); };
        transmuxer.on('data', onData);
        transmuxer.on('error', onError);
        try {
          transmuxer.push(bytes);
          transmuxer.flush();
        } catch {
          eventError = eventError || new HlsError('A transport-stream segment could not be converted to MP4.', 'HLS_TRANSMUXER');
        } finally {
          transmuxer.off?.('data', onData);
          transmuxer.off?.('error', onError);
        }
        if (eventError) throw eventError;
        if (!initSegment || !media.length) fail('A transport-stream segment did not contain supported audio or video samples.', 'HLS_TRANSMUXER');
        if (!media.every(isValidMp4MediaSegment)) fail('A transport-stream segment produced invalid MP4 data.', 'HLS_INVALID_OUTPUT');
        return { initSegment, media };
      },
    };
  };

  const sameMap = (left, right) => !!left && !!right && left.url === right.url &&
    JSON.stringify(left.range || null) === JSON.stringify(right.range || null);

  const mediaPlaylistUnsupportedReason = playlist => {
    if (playlist?.container !== 'fmp4') return '';
    const segments = playlist.segments || [];
    const firstMap = segments[0]?.map;
    if (!firstMap || segments.some(segment => !sameMap(segment.map, firstMap))) {
      return 'Changing or missing fMP4 initialization segments are not supported.';
    }
    if (segments.some(segment => segment.discontinuity)) {
      return 'Discontinuities in fMP4 playlists are not supported.';
    }
    return '';
  };

  const AUDIO_FALLBACK_FATAL_CODES = new Set(['HLS_CANCELLED', 'HLS_PERMISSION', 'HLS_QUOTA', 'HLS_STORAGE']);
  const markAudioFallbackError = error => {
    if (AUDIO_FALLBACK_FATAL_CODES.has(error?.code)) return error;
    const wrapped = new HlsError(error?.message || 'Separate audio could not be combined with video.', error?.code || 'HLS_AUDIO');
    wrapped.hlsAudioFallback = true;
    return wrapped;
  };

  const readTrexDefaultSampleSize = (bytes, trex, expectedTrackId) => {
    if (!trex || trex.size < trex.headerSize + 24 ||
        viewOf(bytes).getUint32(trex.offset + trex.headerSize + 4, false) !== expectedTrackId) {
      fail('MP4 fragment defaults do not match their track.', 'HLS_UNSUPPORTED');
    }
    return viewOf(bytes).getUint32(trex.offset + trex.headerSize + 16, false);
  };

  const validateSeparateVideoInitialization = bytes => {
    const top = readMp4Boxes(bytes);
    const moov = top.find(box => box.type === 'moov');
    if (!isValidMp4InitializationSegment(bytes) || top.filter(box => box.type === 'ftyp').length !== 1 ||
        top.filter(box => box.type === 'moov').length !== 1 || !moov ||
        containsFourCC(bytes, ['pssh', 'tenc', 'sinf', 'encv', 'enca'])) {
      fail('Separate video initialization data is not a supported clear AVC track.', 'HLS_UNSUPPORTED');
    }
    const tracks = getMp4TrackInfo(bytes);
    if (tracks.length !== 1 || tracks[0].handler !== 'vide' ||
        !tracks[0].sampleEntries.length || !tracks[0].sampleEntries.every(type => type === 'avc1' || type === 'avc3') ||
        childBoxes(bytes, tracks[0].trak).some(box => box.type === 'tref')) {
      fail('Separate video initialization data is not a supported clear AVC track.', 'HLS_UNSUPPORTED');
    }
    readMovieTimescale(bytes, moov);
    const mvex = childBoxes(bytes, moov).filter(box => box.type === 'mvex');
    if (mvex.length !== 1) fail('Separate video initialization data has no fragment defaults.', 'HLS_UNSUPPORTED');
    const trex = childBoxes(bytes, mvex[0]).filter(box => box.type === 'trex');
    if (trex.length !== 1) {
      fail('Separate video initialization data has invalid fragment defaults.', 'HLS_UNSUPPORTED');
    }
    return { trackId: tracks[0].trackId, defaultSampleSize: readTrexDefaultSampleSize(bytes, trex[0], tracks[0].trackId) };
  };

  const inspectSeparateFmp4Fragment = (bytes, expectedTrackId, timescale, trexDefaultSampleSize) => {
    if (!(bytes instanceof Uint8Array) || !isValidMp4MediaSegment(bytes)) {
      fail('A separate rendition segment is not a valid fragmented MP4 segment.', 'HLS_UNSUPPORTED');
    }
    const top = readMp4Boxes(bytes);
    const moofs = top.filter(box => box.type === 'moof');
    const mdats = top.filter(box => box.type === 'mdat');
    if (moofs.length !== 1 || mdats.length !== 1) {
      fail('Separate rendition segments must contain one movie fragment and one media-data box.', 'HLS_UNSUPPORTED');
    }
    const moof = moofs[0];
    const mdat = mdats[0];
    const moofIndex = top.indexOf(moof);
    if (moofIndex + 1 >= top.length || top[moofIndex + 1] !== mdat || moof.offset + moof.size !== mdat.offset ||
        top.slice(0, moofIndex).some(box => box.type !== 'styp' && box.type !== 'sidx') || moofIndex + 2 !== top.length) {
      fail('Separate rendition fragments use unsupported media-data offsets.', 'HLS_UNSUPPORTED');
    }
    const moofChildren = childBoxes(bytes, moof);
    const mfhd = moofChildren.filter(box => box.type === 'mfhd');
    const trafs = moofChildren.filter(box => box.type === 'traf');
    if (mfhd.length !== 1 || trafs.length !== 1 || moofChildren.some(box => box.type !== 'mfhd' && box.type !== 'traf')) {
      fail('Separate rendition fragments use unsupported movie-fragment boxes.', 'HLS_UNSUPPORTED');
    }
    const trafChildren = childBoxes(bytes, trafs[0]);
    const tfhds = trafChildren.filter(box => box.type === 'tfhd');
    const tfdts = trafChildren.filter(box => box.type === 'tfdt');
    const truns = trafChildren.filter(box => box.type === 'trun');
    if (tfhds.length !== 1 || tfdts.length !== 1 || !truns.length ||
        trafChildren.some(box => !['tfhd', 'tfdt', 'trun', 'sdtp'].includes(box.type))) {
      fail('Separate rendition fragments use unsupported track-fragment boxes.', 'HLS_UNSUPPORTED');
    }
    const tfhd = tfhds[0];
    const view = viewOf(bytes);
    if (tfhd.size < tfhd.headerSize + 8) fail('Separate rendition track-fragment header is malformed.', 'HLS_UNSUPPORTED');
    const tfhdFullBox = view.getUint32(tfhd.offset + tfhd.headerSize, false);
    if ((tfhdFullBox >>> 24) !== 0) fail('Unsupported separate rendition track-fragment version.', 'HLS_UNSUPPORTED');
    const tfhdFlags = tfhdFullBox & 0xffffff;
    const trackId = view.getUint32(tfhd.offset + tfhd.headerSize + 4, false);
    if (trackId !== expectedTrackId || (tfhdFlags & 0x000001) || !(tfhdFlags & 0x020000)) {
      fail('Separate rendition fragment track IDs or base offsets are unsupported.', 'HLS_UNSUPPORTED');
    }
    const knownTfhdFlags = 0x000002 | 0x000008 | 0x000010 | 0x000020 | 0x010000 | 0x020000;
    if (tfhdFlags & ~knownTfhdFlags) fail('Separate rendition track-fragment flags are unsupported.', 'HLS_UNSUPPORTED');
    let tfhdOffset = tfhd.offset + tfhd.headerSize + 8;
    const tfhdEnd = tfhd.offset + tfhd.size;
    if (tfhdFlags & 0x000002) tfhdOffset += 4;
    if (tfhdFlags & 0x000008) tfhdOffset += 4;
    let tfhdDefaultSampleSize = null;
    if (tfhdFlags & 0x000010) {
      if (tfhdOffset + 4 > tfhdEnd) fail('Separate rendition default sample size is malformed.', 'HLS_UNSUPPORTED');
      tfhdDefaultSampleSize = view.getUint32(tfhdOffset, false);
      tfhdOffset += 4;
    }
    if (tfhdFlags & 0x000020) tfhdOffset += 4;
    if (tfhdOffset !== tfhdEnd) fail('Separate rendition track-fragment header is malformed.', 'HLS_UNSUPPORTED');

    const mdatStart = mdat.offset + mdat.headerSize;
    const mdatEnd = mdat.offset + mdat.size;
    const sampleExtents = [];
    for (const trun of truns) {
      if (trun.size < trun.headerSize + 8) fail('Separate rendition sample-run header is malformed.', 'HLS_UNSUPPORTED');
      const fullBox = view.getUint32(trun.offset + trun.headerSize, false);
      const version = fullBox >>> 24;
      const flags = fullBox & 0xffffff;
      const knownTrunFlags = 0x000001 | 0x000004 | 0x000100 | 0x000200 | 0x000400 | 0x000800;
      if ((version !== 0 && version !== 1) || (flags & ~knownTrunFlags) || !(flags & 0x000001)) {
        fail('Separate rendition fragments require supported sample-run data offsets.', 'HLS_UNSUPPORTED');
      }
      const sampleCount = view.getUint32(trun.offset + trun.headerSize + 4, false);
      let cursor = trun.offset + trun.headerSize + 8;
      const trunEnd = trun.offset + trun.size;
      if (cursor + 4 > trunEnd) fail('Separate rendition sample-run data offset is malformed.', 'HLS_UNSUPPORTED');
      const dataOffset = view.getInt32(cursor, false);
      cursor += 4;
      if (flags & 0x000004) {
        if (cursor + 4 > trunEnd) fail('Separate rendition sample-run flags are malformed.', 'HLS_UNSUPPORTED');
        cursor += 4;
      }
      if ((tfhdFlags & 0x010000) && sampleCount) {
        fail('Empty separate rendition fragments cannot contain samples.', 'HLS_UNSUPPORTED');
      }
      const perSampleFieldCount = [0x000100, 0x000200, 0x000400, 0x000800]
        .filter(flag => flags & flag).length;
      const perSampleBytes = perSampleFieldCount * 4;
      const recordsBytes = sampleCount * perSampleBytes;
      if (!Number.isSafeInteger(recordsBytes) || cursor + recordsBytes !== trunEnd) {
        fail('Separate rendition sample-run entries are malformed.', 'HLS_UNSUPPORTED');
      }
      const sampleSizeOffset = flags & 0x000200 ? (flags & 0x000100 ? 4 : 0) : -1;
      let payloadBytes = 0;
      if (sampleSizeOffset >= 0) {
        if (sampleCount > mdatEnd - mdatStart) fail('Separate rendition sample payload exceeds its media-data box.', 'HLS_UNSUPPORTED');
        for (let index = 0; index < sampleCount; index++) {
          const size = view.getUint32(cursor + index * perSampleBytes + sampleSizeOffset, false);
          if (!size || payloadBytes + size > mdatEnd - mdatStart) {
            fail('Separate rendition sample payload exceeds its media-data box.', 'HLS_UNSUPPORTED');
          }
          payloadBytes += size;
        }
      } else {
        const defaultSize = tfhdDefaultSampleSize ?? trexDefaultSampleSize;
        if (sampleCount && (!Number.isSafeInteger(defaultSize) || defaultSize <= 0)) {
          fail('Separate rendition sample sizes have no supported default.', 'HLS_UNSUPPORTED');
        }
        payloadBytes = sampleCount * (defaultSize || 0);
        if (!Number.isSafeInteger(payloadBytes) || payloadBytes > mdatEnd - mdatStart) {
          fail('Separate rendition sample payload exceeds its media-data box.', 'HLS_UNSUPPORTED');
        }
      }
      const sampleStart = moof.offset + dataOffset;
      const sampleEnd = sampleStart + payloadBytes;
      if (sampleStart < mdatStart || sampleStart > mdatEnd || sampleEnd < sampleStart || sampleEnd > mdatEnd) {
        fail('Separate rendition sample payload points outside its media-data box.', 'HLS_UNSUPPORTED');
      }
      sampleExtents.push({ start: sampleStart, end: sampleEnd });
    }
    sampleExtents.sort((left, right) => left.start - right.start);
    if (sampleExtents.some((extent, index) => index > 0 && extent.start < sampleExtents[index - 1].end)) {
      fail('Separate rendition sample payloads overlap.', 'HLS_UNSUPPORTED');
    }
    const tfdt = tfdts[0];
    const version = mp4FullBoxVersion(bytes, tfdt);
    let decodeTime;
    if (version === 0) decodeTime = viewOf(bytes).getUint32(tfdt.offset + tfdt.headerSize + 4, false);
    else if (version === 1) decodeTime = readUint64Safe(bytes, tfdt.offset + tfdt.headerSize + 4);
    else fail('Unsupported MP4 decode-time version.', 'HLS_UNSUPPORTED');
    if (!timescale) fail('Separate rendition track timescale is invalid.', 'HLS_UNSUPPORTED');
    return { decodeTime, seconds: decodeTime / timescale, moof, mfhd: mfhd[0], tfhd, mdat, top };
  };

  const remapSeparateFmp4Fragment = (bytes, inspected, outputTrackId, sequenceNumber) => {
    const styp = inspected.top.filter(box => box.type === 'styp').map(box => copyBox(bytes, box));
    const moofBytes = normalizeMp4BoxSizes(copyBox(bytes, inspected.moof));
    patchBoxUint32(moofBytes, inspected.mfhd.offset - inspected.moof.offset + inspected.mfhd.headerSize + 4, sequenceNumber);
    patchBoxUint32(moofBytes, inspected.tfhd.offset - inspected.moof.offset + inspected.tfhd.headerSize + 4, outputTrackId);
    const mdatBytes = normalizeMp4BoxSizes(copyBox(bytes, inspected.mdat));
    return concatBytes([...styp, moofBytes, mdatBytes]);
  };

  const variantUnsupportedReason = (variant) => {
    if (variant?.videoGroup) return 'separate video renditions are not supported';
    const codecs = (variant?.codecs || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    const isAvc = codec => /^(?:avc1|avc3)(?:\.|$)/.test(codec);
    const isAac = codec => /^mp4a\.40\.(?:2|5|29)$/.test(codec);
    const isKnownNonAvcVideo = codec => /^(?:hvc1|hev1|vp09|av01|dvhe|dvh1|mp4v|theora)(?:\.|$)/.test(codec);
    const isAudioCodec = codec => /^(?:mp4a(?:\.|$)|ac-3(?:\.|$)|ec-3(?:\.|$)|ac-4(?:\.|$)|opus(?:\.|$)|flac(?:\.|$)|alac(?:\.|$)|dts[cehlx](?:\.|$)|samr(?:\.|$)|sawb(?:\.|$)|lpcm(?:\.|$)|ulaw(?:\.|$)|alaw(?:\.|$)|mha1(?:\.|$)|mhm1(?:\.|$))/.test(codec);
    if (variant?.separateAudio) {
      if (codecs.some(isKnownNonAvcVideo)) return 'video codec is not supported for MP4 output';
      if (codecs.some(codec => !isAvc(codec) && !isAac(codec) && !isAudioCodec(codec))) {
        return 'codec is not supported for MP4 output';
      }
      // External audio is optional. CODECS may omit it or name a format that
      // this muxer cannot combine; validate the actual video init segment and
      // fall back to video-only if the external rendition is incompatible.
      return '';
    }
    if (codecs.length && !codecs.every(codec => isAvc(codec) || isAac(codec))) return 'codec is not supported for MP4 output';
    return '';
  };

  const statusError = statusCode => {
    if (statusCode === 403) return new HlsError('HTTP 403: access was denied; the signed link may have expired.', 'HLS_HTTP');
    if (statusCode === 404) return new HlsError('HTTP 404: a playlist or media segment was not found.', 'HLS_HTTP');
    if (statusCode === 429) return new HlsError('HTTP 429: the site kept rate-limiting the download.', 'HLS_HTTP');
    return new HlsError(`HTTP ${statusCode}: the site rejected a playlist or media request.`, 'HLS_HTTP');
  };

  const retryDelay = (response, attempt, random = Math.random) => {
    const value = response?.headers?.get?.('retry-after');
    if (value) {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) return Math.min(10000, Math.max(0, seconds * 1000));
      const date = Date.parse(value);
      if (Number.isFinite(date)) return Math.min(10000, Math.max(0, date - Date.now()));
    }
    return Math.min(8000, 400 * (2 ** attempt)) + Math.floor(random() * 180);
  };

  const waitForRetry = (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new HlsError('Download cancelled.', 'HLS_CANCELLED'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new HlsError('Download cancelled.', 'HLS_CANCELLED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  const requestWithRetry = async (url, requestInit = {}, options = {}) => {
    const safeUrl = resolveHttpUrl(url, options.baseUrl || url, 'playlist or segment');
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const processResponse = options.processResponse || (response => response);
    const ensureRefererRule = options.ensureRefererRule || (() => Promise.resolve());
    const waitFn = options.waitFn || waitForRetry;
    const attempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    if (typeof fetchImpl !== 'function') fail('Network fetch is unavailable.', 'HLS_NETWORK');

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (requestInit.signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      let response = null;
      try {
        await ensureRefererRule(safeUrl);
        response = await fetchImpl(safeUrl, requestInit);
        if (response.status >= 300 && response.status < 400) {
          fail('HLS redirects are not supported by this downloader.', 'HLS_REDIRECT');
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt + 1 >= attempts) throw statusError(response.status);
          const delayMs = retryDelay(response, attempt, options.random || Math.random);
          response.body?.cancel?.();
          await waitFn(delayMs, requestInit.signal);
          continue;
        }
        if (!response.ok) throw statusError(response.status);
        return await processResponse(response, safeUrl);
      } catch (error) {
        if (requestInit.signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
        if (error?.code === 'HLS_PERMISSION') throw new HlsError(error.message, 'HLS_PERMISSION');
        if (error instanceof HlsError && error.code !== 'HLS_NETWORK') throw error;
        response?.body?.cancel?.();
        if (attempt + 1 >= attempts) {
          if (error instanceof HlsError) throw error;
          fail('Network request failed after retries. The site or CDN may block extension fetches.', 'HLS_NETWORK');
        }
        await waitFn(retryDelay(null, attempt, options.random || Math.random), requestInit.signal);
      }
    }
    fail('Network request failed.', 'HLS_NETWORK');
  };

  const downloadMediaPlaylist = async (playlist, options = {}) => {
    const { fetchBytes, appendChunk, signal, onProgress, muxjs } = options;
    const requestedConcurrency = Number(options.concurrency);
    const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
      ? Math.max(1, Math.min(LIMITS.CONCURRENCY, Math.floor(requestedConcurrency)))
      : LIMITS.CONCURRENCY;
    const requestedOutputLimit = Number(options.maxOutputBytes);
    const maxOutputBytes = Number.isFinite(requestedOutputLimit) && requestedOutputLimit > 0
      ? Math.min(LIMITS.MAX_OPFS_OUTPUT_BYTES, Math.floor(requestedOutputLimit))
      : LIMITS.MAX_OUTPUT_BYTES;
    if (!playlist?.segments?.length || typeof fetchBytes !== 'function' || typeof appendChunk !== 'function') {
      fail('Media download could not be started.', 'HLS_MALFORMED');
    }
    if (playlist.segments.length > LIMITS.MAX_SEGMENTS) fail('Playlist has too many media segments.', 'HLS_LIMIT');
    if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');

    const isFmp4 = playlist.container === 'fmp4';
    const unsupportedReason = mediaPlaylistUnsupportedReason(playlist);
    if (unsupportedReason) fail(unsupportedReason, 'HLS_UNSUPPORTED');
    const firstMap = playlist.segments[0].map;

    let totalInputBytes = 0;
    let totalOutputBytes = 0;
    let writtenSegments = 0;
    let firstOutputWritten = false;
    let mediaOutputCount = 0;
    let outputHasAudio = false;
    const write = async (bytes) => {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail('Empty media data was returned.', 'HLS_MISSING_SEGMENT');
      bytes = normalizeMp4BoxSizes(bytes);
      if (!firstOutputWritten) {
        if (!isValidMp4InitializationSegment(bytes)) fail('The playlist did not produce a valid MP4 initialization segment.', 'HLS_INVALID_OUTPUT');
        outputHasAudio = getMp4TrackInfo(bytes).some(track => track.handler === 'soun');
        firstOutputWritten = true;
      } else {
        if (!isValidMp4MediaSegment(bytes)) fail('The playlist contains an invalid or incompatible MP4 media segment.', 'HLS_INVALID_OUTPUT');
        mediaOutputCount++;
      }
      totalOutputBytes += bytes.byteLength;
      if (totalOutputBytes > maxOutputBytes) fail('Output exceeds the selected browser storage limit.', 'HLS_LIMIT');
      try {
        await appendChunk(bytes, totalOutputBytes - bytes.byteLength);
      } catch (error) {
        if (error?.code === 'HLS_LIMIT') throw error;
        if (error?.code === 'HLS_QUOTA' || error?.name === 'QuotaExceededError') {
          fail('Browser storage is full. Free disk space and retry.', 'HLS_QUOTA');
        }
        fail('Could not save the MP4 output to browser storage.', 'HLS_STORAGE');
      }
    };

    if (isFmp4) {
      const mapBytes = normalizeMp4BoxSizes(await fetchBytes(firstMap.url, firstMap.range, signal));
      totalInputBytes += mapBytes.byteLength;
      if (!isValidMp4InitializationSegment(mapBytes)) fail('The HLS initialization segment is not a compatible MP4 file.', 'HLS_UNSUPPORTED');
      await write(mapBytes);
    }

    const transmuxer = isFmp4 ? null : createTsTransmuxer(muxjs);
    let elapsedSeconds = 0;
    for (let start = 0; start < playlist.segments.length; start += concurrency) {
      if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      const batch = playlist.segments.slice(start, start + concurrency);
      const fetched = await Promise.all(batch.map(segment => fetchBytes(segment.url, segment.range, signal)));
      if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      for (let i = 0; i < batch.length; i++) {
        const segment = batch[i];
        const bytes = fetched[i];
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMITS.MAX_SEGMENT_BYTES) fail('A media segment exceeds the supported size limit.', 'HLS_LIMIT');
        totalInputBytes += bytes.byteLength;
        if (totalInputBytes > maxOutputBytes) fail('Playlist input exceeds the selected browser storage limit.', 'HLS_LIMIT');
        if (isFmp4) {
          if (!isValidMp4MediaSegment(bytes)) fail('A playlist segment is not a compatible fragmented MP4 segment.', 'HLS_UNSUPPORTED');
          await write(normalizeMp4BoxSizes(bytes));
        } else {
          const converted = transmuxer.push(bytes, elapsedSeconds, segment.discontinuity);
          if (writtenSegments === 0) await write(converted.initSegment);
          for (const chunk of converted.media) await write(chunk);
        }
        writtenSegments++;
        elapsedSeconds += segment.duration;
        onProgress?.({ completed: writtenSegments, total: playlist.segments.length, bytes: totalInputBytes });
      }
    }

    if (!firstOutputWritten || mediaOutputCount === 0) fail('The playlist did not produce a complete MP4 file.', 'HLS_INVALID_OUTPUT');
    return {
      bytes: totalOutputBytes,
      mediaSegments: mediaOutputCount,
      inputBytes: totalInputBytes,
      segments: writtenSegments,
      container: isFmp4 ? 'fmp4' : 'ts',
      hasAudio: outputHasAudio,
    };
  };

  const downloadSeparateFmp4Playlists = async (videoPlaylist, audioPlaylist, options = {}) => {
    const { fetchBytes, appendChunk, signal, onProgress } = options;
    const requestedConcurrency = Number(options.concurrency);
    const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
      ? Math.max(1, Math.min(LIMITS.CONCURRENCY, Math.floor(requestedConcurrency)))
      : LIMITS.CONCURRENCY;
    const requestedOutputLimit = Number(options.maxOutputBytes);
    const maxOutputBytes = Number.isFinite(requestedOutputLimit) && requestedOutputLimit > 0
      ? Math.min(LIMITS.MAX_OPFS_OUTPUT_BYTES, Math.floor(requestedOutputLimit))
      : LIMITS.MAX_OUTPUT_BYTES;
    if (!videoPlaylist?.segments?.length || !audioPlaylist?.segments?.length ||
        typeof fetchBytes !== 'function' || typeof appendChunk !== 'function') {
      fail('Separate HLS audio and video playlists are incomplete.', 'HLS_MALFORMED');
    }
    if (videoPlaylist.container !== 'fmp4') {
      throw markAudioFallbackError(new HlsError('Video and separate audio cannot be combined because the video playlist is not fragmented MP4.', 'HLS_UNSUPPORTED'));
    }
    if (audioPlaylist.container !== 'fmp4') {
      throw markAudioFallbackError(new HlsError('Separate audio and video renditions must both use fragmented MP4.', 'HLS_UNSUPPORTED'));
    }
    const videoUnsupportedReason = mediaPlaylistUnsupportedReason(videoPlaylist);
    if (videoUnsupportedReason) fail(videoUnsupportedReason, 'HLS_UNSUPPORTED');
    const audioUnsupportedReason = mediaPlaylistUnsupportedReason(audioPlaylist);
    if (audioUnsupportedReason) {
      throw markAudioFallbackError(new HlsError(audioUnsupportedReason, 'HLS_UNSUPPORTED'));
    }
    const totalSegments = videoPlaylist.segments.length + audioPlaylist.segments.length;
    if (totalSegments > LIMITS.MAX_SEGMENTS) {
      throw markAudioFallbackError(new HlsError('Separate playlists have too many combined media segments.', 'HLS_LIMIT'));
    }
    if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');

    let videoMapBytes = normalizeMp4BoxSizes(await fetchBytes(videoPlaylist.segments[0].map.url, videoPlaylist.segments[0].map.range, signal));
    if (!(videoMapBytes instanceof Uint8Array) || videoMapBytes.byteLength > LIMITS.MAX_SEGMENT_BYTES) {
      fail('The video initialization segment exceeds the supported size limit.', 'HLS_LIMIT');
    }
    const videoDefaults = validateSeparateVideoInitialization(videoMapBytes);
    let audioMapBytes;
    try {
      audioMapBytes = normalizeMp4BoxSizes(await fetchBytes(audioPlaylist.segments[0].map.url, audioPlaylist.segments[0].map.range, signal));
    } catch (error) {
      throw markAudioFallbackError(error);
    }
    if (!(audioMapBytes instanceof Uint8Array) || audioMapBytes.byteLength > LIMITS.MAX_SEGMENT_BYTES) {
      throw markAudioFallbackError(new HlsError('The audio initialization segment exceeds the supported size limit.', 'HLS_LIMIT'));
    }
    let totalInputBytes = videoMapBytes.byteLength + audioMapBytes.byteLength;
    if (totalInputBytes > maxOutputBytes) {
      throw markAudioFallbackError(new HlsError('Separate playlist input exceeds the selected browser storage limit.', 'HLS_LIMIT'));
    }
    let initialization;
    try { initialization = buildCompatibleFmp4Initialization(videoMapBytes, audioMapBytes); }
    catch (error) { throw markAudioFallbackError(error); }
    videoMapBytes = null;
    audioMapBytes = null;

    let totalOutputBytes = 0;
    let outputOffset = 0;
    let sequenceNumber = 1;
    let outputSegments = 0;
    let initWritten = false;
    const write = async bytes => {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail('Empty media data was returned.', 'HLS_MISSING_SEGMENT');
      if (!initWritten) {
        const tracks = getMp4TrackInfo(bytes);
        if (!isValidMp4InitializationSegment(bytes) || tracks.length !== 2 ||
            !tracks.some(track => track.handler === 'vide' && track.sampleEntries.some(type => type === 'avc1' || type === 'avc3')) ||
            !tracks.some(track => track.handler === 'soun' && track.sampleEntries.includes('mp4a'))) {
          fail('Combined audio and video initialization data is invalid.', 'HLS_INVALID_OUTPUT');
        }
      } else if (!isValidMp4MediaSegment(bytes)) {
        fail('A combined MP4 media fragment is invalid.', 'HLS_INVALID_OUTPUT');
      }
      totalOutputBytes += bytes.byteLength;
      if (totalOutputBytes > maxOutputBytes) fail('Output exceeds the selected browser storage limit.', 'HLS_LIMIT');
      try {
        await appendChunk(bytes, outputOffset);
        outputOffset += bytes.byteLength;
        if (!initWritten) initWritten = true;
      } catch (error) {
        if (error?.code === 'HLS_LIMIT') throw error;
        if (error?.code === 'HLS_QUOTA' || error?.name === 'QuotaExceededError') {
          fail('Browser storage is full. Free disk space and retry.', 'HLS_QUOTA');
        }
        fail('Could not save the MP4 output to browser storage.', 'HLS_STORAGE');
      }
    };
    try { await write(initialization.bytes); }
    catch (error) {
      if (['HLS_INVALID_OUTPUT', 'HLS_UNSUPPORTED'].includes(error?.code)) throw markAudioFallbackError(error);
      throw error;
    }

    const tracks = [
      {
        kind: 'video',
        playlist: videoPlaylist,
        sourceTrackId: initialization.sourceVideoTrackId,
        outputTrackId: initialization.videoTrackId,
        timescale: initialization.videoTimescale,
        defaultSampleSize: initialization.sourceVideoDefaultSampleSize ?? videoDefaults.defaultSampleSize,
        nextIndex: 0,
        lastDecodeTime: -1,
        queue: [],
      },
      {
        kind: 'audio',
        playlist: audioPlaylist,
        sourceTrackId: initialization.sourceAudioTrackId,
        outputTrackId: initialization.audioTrackId,
        timescale: initialization.audioTimescale,
        defaultSampleSize: initialization.sourceAudioDefaultSampleSize,
        nextIndex: 0,
        lastDecodeTime: -1,
        queue: [],
      },
    ];
    let fillCursor = 0;
    let completedSegments = 0;

    const fetchFragment = async (track, index) => {
      if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      const segment = track.playlist.segments[index];
      const bytes = await fetchBytes(segment.url, segment.range, signal);
      if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMITS.MAX_SEGMENT_BYTES) {
        fail('A media segment exceeds the supported size limit.', 'HLS_LIMIT');
      }
      const inspected = inspectSeparateFmp4Fragment(bytes, track.sourceTrackId, track.timescale, track.defaultSampleSize);
      return { track, segment, bytes, inspected };
    };

    const fetchIntoQueues = async selectedTracks => {
      const requests = selectedTracks.map(track => {
        const segmentIndex = track.nextIndex++;
        return { track, promise: fetchFragment(track, segmentIndex) };
      });
      // Preserve request order while attributing a rejection to its rendition.
      // If both fail in one batch, a video failure always blocks audio fallback.
      const settled = await Promise.allSettled(requests.map(request => request.promise));
      const videoFailure = settled.find((result, index) => result.status === 'rejected' && requests[index].track.kind === 'video');
      if (videoFailure) throw videoFailure.reason;
      const audioFailure = settled.find(result => result.status === 'rejected');
      if (audioFailure) throw markAudioFallbackError(audioFailure.reason);
      const fetched = settled.map(result => result.value);
      for (const item of fetched) {
        if (item.inspected.decodeTime < item.track.lastDecodeTime) {
          const error = new HlsError('Separate rendition fragments are not ordered by decode time.', 'HLS_MALFORMED');
          if (item.track.kind === 'audio') throw markAudioFallbackError(error);
          throw error;
        }
        item.track.lastDecodeTime = item.inspected.decodeTime;
        item.track.queue.push(item);
        totalInputBytes += item.bytes.byteLength;
        if (totalInputBytes > maxOutputBytes) {
          const error = new HlsError('Playlist input exceeds the selected browser storage limit.', 'HLS_LIMIT');
          if (item.track.kind === 'audio') throw markAudioFallbackError(error);
          throw error;
        }
      }
    };

    const fillQueues = async () => {
      // Always keep a lookahead fragment for every unfinished track before
      // choosing the next global decode-time. With concurrency=1 these two
      // requests run sequentially and hold at most one fragment per track.
      const missingHeads = tracks.filter(track => !track.queue.length && track.nextIndex < track.playlist.segments.length);
      for (let start = 0; start < missingHeads.length; start += concurrency) {
        await fetchIntoQueues(missingHeads.slice(start, start + concurrency));
      }

      let capacity = concurrency - tracks.reduce((count, track) => count + track.queue.length, 0);
      if (capacity <= 0) return;
      const extraTracks = [];
      while (extraTracks.length < capacity) {
        let selected = -1;
        for (let search = 0; search < tracks.length; search++) {
          const index = (fillCursor + search) % tracks.length;
          const track = tracks[index];
          const alreadyScheduled = extraTracks.filter(item => item === track).length;
          if (track.nextIndex + alreadyScheduled < track.playlist.segments.length) {
            selected = index;
            break;
          }
        }
        if (selected < 0) break;
        const track = tracks[selected];
        extraTracks.push(track);
        fillCursor = (selected + 1) % tracks.length;
      }
      for (let start = 0; start < extraTracks.length; start += concurrency) {
        await fetchIntoQueues(extraTracks.slice(start, start + concurrency));
      }
    };

    await fillQueues();
    while (tracks.some(track => track.queue.length)) {
      if (signal?.aborted) fail('Download cancelled.', 'HLS_CANCELLED');
      let selectedTrack = null;
      for (const track of tracks) {
        if (!track.queue.length) continue;
        if (!selectedTrack) {
          selectedTrack = track;
          continue;
        }
        const candidateTime = BigInt(track.queue[0].inspected.decodeTime) * BigInt(selectedTrack.timescale);
        const selectedTime = BigInt(selectedTrack.queue[0].inspected.decodeTime) * BigInt(track.timescale);
        if (candidateTime < selectedTime) selectedTrack = track;
      }
      const fragment = selectedTrack.queue.shift();
      const remapped = remapSeparateFmp4Fragment(fragment.bytes, fragment.inspected, selectedTrack.outputTrackId, sequenceNumber++);
      try { await write(remapped); }
      catch (error) {
        if (selectedTrack.kind === 'audio' && error?.code === 'HLS_INVALID_OUTPUT') throw markAudioFallbackError(error);
        throw error;
      }
      outputSegments++;
      completedSegments++;
      onProgress?.({ completed: completedSegments, total: totalSegments, bytes: totalInputBytes });
      await fillQueues();
    }

    if (outputSegments !== totalSegments) fail('Separate MP4 tracks did not produce a complete file.', 'HLS_INVALID_OUTPUT');
    return {
      bytes: totalOutputBytes,
      mediaSegments: outputSegments,
      inputBytes: totalInputBytes,
      segments: completedSegments,
      videoSegments: videoPlaylist.segments.length,
      audioSegments: audioPlaylist.segments.length,
      container: 'fmp4-av',
      hasAudio: true,
    };
  };

  return {
    HlsError,
    LIMITS,
    sanitizeOutputFilename,
    parseAttributeList,
    parseByteRange,
    parseMasterPlaylist,
    parseMediaPlaylist,
    mediaPlaylistUnsupportedReason,
    variantUnsupportedReason,
    requestWithRetry,
    resolveHttpUrl,
    isTransportStream,
    readMp4Boxes,
    getMp4SampleEntryTypes,
    isValidMp4InitializationSegment,
    isValidMp4MediaSegment,
    validateFmp4Output,
    createTsTransmuxer,
    downloadMediaPlaylist,
    downloadSeparateFmp4Playlists,
  };
});
