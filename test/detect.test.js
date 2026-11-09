const fs = require('fs');
const path = require('path');
const vm = require('vm');

const detectSource = fs.readFileSync(path.join(__dirname, '../detect.js'), 'utf8');

function runDetection({ url = 'https://myppt.example/view/slide', images = [], preloads = [], iframes = [], resources = [] } = {}) {
  const document = {
    querySelectorAll(selector) {
      if (selector === 'img') return images;
      if (selector === 'link[rel~="preload"][as="image"]') return preloads;
      if (selector === 'video' || selector === 'embed' || selector === 'object') return [];
      if (selector === 'iframe') return iframes;
      return [];
    },
    querySelector() { return null; },
  };
  const window = {};

  vm.runInNewContext(detectSource, {
    window,
    document,
    location: { href: url },
    performance: { getEntriesByType: () => resources },
    URL,
  });

  return window.__gdriveUniversalDownloader;
}

const timingEntry = (name, initiatorType = 'img', sizes = {}) => ({
  name,
  initiatorType,
  transferSize: sizes.transferSize ?? 5000,
  decodedBodySize: sizes.decodedBodySize ?? 4500,
});

describe('detect.js Resource Timing image candidates', () => {
  test('finds three hashed JPG image requests and ignores an iframe ad', () => {
    const urls = [
      'https://cdn.myppt.example/assets/slide-a83f19d4e32b4c4f8a0d93c2bb7e114a.jpg?token=first%2Fvalue',
      'https://cdn.myppt.example/assets/slide-b72d04e8a53b4f9791b5d1c6e2a8340f.jpg?token=second%2Fvalue',
      'https://cdn.myppt.example/assets/slide-c41e8a5f7d204ba2a6c1e9d3f5087b64.jpg?token=third%2Fvalue',
    ];
    const result = runDetection({
      resources: [
        ...urls.map(url => timingEntry(url)),
        timingEntry('https://ads.example/banner.jpg?campaign=canvas', 'iframe'),
      ],
    });

    expect(result.detectedType).toBe('universal');
    expect(result.universalResources.images.map(image => image.src)).toEqual(urls);
    expect(result.universalResources.images).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'performance', w: 0, h: 0 }),
    ]));
    expect(result.universalResources.images).toHaveLength(3);
    expect(result.universalResources.images.every(image => image.source === 'performance' && image.w === 0 && image.h === 0)).toBe(true);
    expect(result.universalResources.images.some(image => image.src.includes('ads.example'))).toBe(false);
  });

  test('deduplicates normalized URLs across DOM images, preload hints, and timing entries', () => {
    const domUrl = 'https://site.example/images/card.jpg?size=large#dom';
    const preloadUrl = 'https://site.example/images/preview.png?sig=abc#preload';
    const result = runDetection({
      images: [{ src: domUrl, alt: 'card', title: '', naturalWidth: 240, naturalHeight: 160, width: 240, height: 160 }],
      preloads: [{ href: preloadUrl }],
      resources: [
        timingEntry('https://site.example/images/card.jpg?size=large#timing'),
        timingEntry('https://site.example/images/preview.png?sig=abc#timing'),
        timingEntry('https://site.example/images/new-photo.jpg?sig=xyz#timing'),
      ],
    });

    const images = result.universalResources.images;
    expect(images).toHaveLength(3);
    expect(images.filter(image => image.source === 'performance').map(image => image.src))
      .toEqual(['https://site.example/images/new-photo.jpg?sig=xyz#timing']);
    expect(images.find(image => image.alt === 'card')).toMatchObject({ w: 240, h: 160 });
    expect(images.find(image => image.source === 'preload').src).toBe(preloadUrl);
  });

  test('caps new timing candidates at the remaining 50-image capacity', () => {
    const domUrls = Array.from({ length: 30 }, (_, index) =>
      `https://site.example/dom/${index}.jpg?token=${index}${index === 0 ? '#dom' : ''}`);
    const preloadUrls = Array.from({ length: 18 }, (_, index) =>
      `https://site.example/preload/${index}.png?token=${index}`);
    const performanceUrls = [
      'https://site.example/dom/0.jpg?token=0#timing', // duplicate DOM URL, fragment ignored
      'https://site.example/preload/0.png?token=0#timing', // duplicate preload URL
      'https://site.example/timing/first.jpg?sig=first',
      'https://site.example/timing/second.jpg?sig=second',
      'https://site.example/timing/third.jpg?sig=third',
    ];
    const result = runDetection({
      images: domUrls.map((src, index) => ({
        src, alt: `DOM ${index}`, title: '', naturalWidth: 120, naturalHeight: 120, width: 120, height: 120,
      })),
      preloads: preloadUrls.map(href => ({ href })),
      resources: performanceUrls.map(url => timingEntry(url)),
    });

    const images = result.universalResources.images;
    expect(images).toHaveLength(50);
    expect(images.slice(0, 30).map(image => image.src)).toEqual(domUrls);
    expect(images.slice(30, 48).map(image => image.src)).toEqual(preloadUrls);
    expect(images.slice(48).map(image => image.src)).toEqual(performanceUrls.slice(2, 4));
    expect(images.slice(48).every(image => image.source === 'performance')).toBe(true);
  });

  test('accepts HTTP(S) image-like timing URLs and rejects other protocols and initiators', () => {
    const validUrls = [
      'http://cdn.example/photo?auth=one',
      'https://cdn.example/load?kind=image&sig=two',
    ];
    const result = runDetection({
      resources: [
        ...validUrls.map(url => timingEntry(url)),
        timingEntry('ftp://cdn.example/image.jpg'),
        timingEntry('data:image/jpeg;base64,AAAA'),
        timingEntry('blob:https://site.example/abc.jpg'),
        timingEntry('https://cdn.example/not-an-image', 'script'),
      ],
    });

    expect(result.universalResources.images.filter(image => image.source === 'performance').map(image => image.src))
      .toEqual(validUrls);
  });

  test('preserves existing DOM image detection and dimensions', () => {
    const image = { src: 'https://site.example/photo.jpg?version=7', alt: 'portrait', title: '', naturalWidth: 320, naturalHeight: 240, width: 320, height: 240 };
    const result = runDetection({ images: [image] });

    expect(result.detectedType).toBe('universal');
    expect(result.universalResources.images).toEqual([
      expect.objectContaining({ type: 'image', src: image.src, alt: 'portrait', w: 320, h: 240 }),
    ]);
  });
});
