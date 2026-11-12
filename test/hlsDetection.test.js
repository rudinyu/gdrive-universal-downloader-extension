const fs = require('fs');
const path = require('path');
const vm = require('vm');

const hooksSource = fs.readFileSync(path.join(__dirname, '../content-hooks.js'), 'utf8');
const detectSource = fs.readFileSync(path.join(__dirname, '../detect.js'), 'utf8');

describe('HLS candidate detection', () => {
  test('resolves relative fetch and XHR playlist URLs in the early page hook', async () => {
    function FakeXHR() {}
    FakeXHR.prototype.open = function () { return this; };
    const pageWindow = {};
    const context = {
      window: pageWindow,
      location: { href: 'https://watch.example/video/page' },
      XMLHttpRequest: FakeXHR,
      fetch: jest.fn(async () => ({ ok: true })),
      URL,
    };
    vm.runInNewContext(hooksSource, context);

    new context.XMLHttpRequest().open('GET', '../streams/xhr.m3u8?token=xhr-secret');
    await pageWindow.fetch('/streams/fetch.m3u8?token=fetch-secret');

    expect([...pageWindow.__gdriveUniversalDownloader.capturedHlsURLs]).toEqual([
      'https://watch.example/streams/xhr.m3u8?token=xhr-secret',
      'https://watch.example/streams/fetch.m3u8?token=fetch-secret',
    ]);
  });

  test('prefers a captured or timed HLS playlist in the popup detection result', () => {
    const window = {
      __gdriveUniversalDownloader: {
        capturedHlsURLs: new Set(['https://cdn.example/hls/index.m3u8?sig=secret']),
      },
    };
    const document = {
      querySelectorAll: () => [],
      querySelector: () => null,
    };
    vm.runInNewContext(detectSource, {
      window,
      document,
      location: { href: 'https://watch.example/page' },
      performance: { getEntriesByType: () => [{ name: 'https://cdn.example/hls/index.m3u8?sig=timing', initiatorType: 'fetch' }] },
      URL,
    });

    expect(window.__gdriveUniversalDownloader.detectedType).toBe('universal');
    expect(window.__gdriveUniversalDownloader.hlsPlaylists).toEqual([
      'https://cdn.example/hls/index.m3u8?sig=secret',
      'https://cdn.example/hls/index.m3u8?sig=timing',
    ]);
    expect(window.__gdriveUniversalDownloader.universalResources.hls.map(item => item.src)).toEqual([
      'https://cdn.example/hls/index.m3u8?sig=secret',
      'https://cdn.example/hls/index.m3u8?sig=timing',
    ]);
  });

  test('deduplicates the same signed playlist URL found by multiple discovery paths', () => {
    const playlistUrl = 'https://cdn.example/hls/index.m3u8?sig=secret';
    const window = {
      __gdriveUniversalDownloader: { capturedHlsURLs: new Set([playlistUrl]) },
    };
    const document = { querySelectorAll: () => [], querySelector: () => null };
    vm.runInNewContext(detectSource, {
      window,
      document,
      location: { href: 'https://watch.example/page' },
      performance: { getEntriesByType: () => [{ name: playlistUrl }, { name: playlistUrl }] },
      URL,
    });

    expect(window.__gdriveUniversalDownloader.hlsPlaylists).toEqual([playlistUrl]);
    expect(window.__gdriveUniversalDownloader.universalResources.hls).toHaveLength(1);
  });

  test('keeps HLS alongside existing images, videos, and PDFs in universal resources', () => {
    const image = { src: 'https://site.example/photo.jpg', alt: 'photo', width: 200, height: 120 };
    const video = {
      currentSrc: 'https://site.example/preview.mp4', src: '', poster: '',
      querySelectorAll: () => [],
    };
    const pdf = { type: 'application/pdf', src: 'https://site.example/guide.pdf' };
    const playlistUrl = 'https://cdn.example/hls/index.m3u8?sig=secret';
    const window = { __gdriveUniversalDownloader: { capturedHlsURLs: new Set([playlistUrl]) } };
    const document = {
      querySelectorAll(selector) {
        if (selector === 'video[src], audio[src], source[src], a[href]') return [];
        if (selector === 'img') return [image];
        if (selector === 'video') return [video];
        if (selector === 'embed') return [pdf];
        return [];
      },
      querySelector: () => null,
    };

    vm.runInNewContext(detectSource, {
      window,
      document,
      location: { href: 'https://site.example/gallery' },
      performance: { getEntriesByType: () => [] },
      URL,
    });

    expect(window.__gdriveUniversalDownloader.detectedType).toBe('universal');
    expect(window.__gdriveUniversalDownloader.universalResources).toMatchObject({
      images: [expect.objectContaining({ src: image.src })],
      videos: [expect.objectContaining({ src: video.currentSrc })],
      pdfs: [expect.objectContaining({ src: pdf.src })],
      hls: [expect.objectContaining({ src: playlistUrl })],
    });
  });
});
