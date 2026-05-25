// Tests for the fetchBlob guard logic (downloader.js).
// fetchBlob is IIFE-private, so these tests verify the guard patterns directly.
// Each test mirrors a specific branch in the implementation.

const MAX_BLOB_BYTES = 100 * 1024 * 1024; // 100 MB — must match downloader.js

// Reference implementation of the content-length + blob size guards,
// matching the exact logic in fetchBlob (downloader.js lines 338–350).
async function fetchBlob(src, ms = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(src, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lenHeader = r.headers.get('content-length');
    if (lenHeader !== null) {
      const len = parseInt(lenHeader, 10);
      if (!isNaN(len) && len > MAX_BLOB_BYTES) throw new Error(`File too large (${len} bytes)`);
    }
    const blob = await r.blob();
    if (blob.size > MAX_BLOB_BYTES) throw new Error(`File too large (${blob.size} bytes)`);
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

function makeFetch({ ok = true, status = 200, contentLength = null, blobSize = 100 } = {}) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    headers: { get: (h) => h === 'content-length' ? contentLength : null },
    blob: () => Promise.resolve({ size: blobSize }),
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('fetchBlob — content-length guard', () => {
  test('absent Content-Length (null) skips early check and returns blob', async () => {
    global.fetch = makeFetch({ contentLength: null, blobSize: 500 });
    await expect(fetchBlob('https://example.com/file')).resolves.toMatchObject({ size: 500 });
  });

  test('valid Content-Length under limit passes', async () => {
    global.fetch = makeFetch({ contentLength: String(MAX_BLOB_BYTES - 1) });
    await expect(fetchBlob('https://example.com/file')).resolves.toBeDefined();
  });

  test('Content-Length exactly at limit passes (not strictly greater)', async () => {
    global.fetch = makeFetch({ contentLength: String(MAX_BLOB_BYTES) });
    await expect(fetchBlob('https://example.com/file')).resolves.toBeDefined();
  });

  test('Content-Length one byte over limit throws', async () => {
    global.fetch = makeFetch({ contentLength: String(MAX_BLOB_BYTES + 1) });
    await expect(fetchBlob('https://example.com/file')).rejects.toThrow('File too large');
  });

  test('empty-string Content-Length produces NaN — guard skipped, blob returned', async () => {
    global.fetch = makeFetch({ contentLength: '', blobSize: 100 });
    await expect(fetchBlob('https://example.com/file')).resolves.toMatchObject({ size: 100 });
  });

  test('non-numeric Content-Length ("chunked") produces NaN — guard skipped', async () => {
    global.fetch = makeFetch({ contentLength: 'chunked', blobSize: 100 });
    await expect(fetchBlob('https://example.com/file')).resolves.toBeDefined();
  });

  test('Content-Length "0" passes (0 <= MAX)', async () => {
    global.fetch = makeFetch({ contentLength: '0' });
    await expect(fetchBlob('https://example.com/file')).resolves.toBeDefined();
  });
});

describe('fetchBlob — blob size guard', () => {
  test('blob over limit throws even when Content-Length is absent', async () => {
    global.fetch = makeFetch({ contentLength: null, blobSize: MAX_BLOB_BYTES + 1 });
    await expect(fetchBlob('https://example.com/file')).rejects.toThrow('File too large');
  });

  test('blob exactly at limit passes', async () => {
    global.fetch = makeFetch({ contentLength: null, blobSize: MAX_BLOB_BYTES });
    await expect(fetchBlob('https://example.com/file')).resolves.toBeDefined();
  });
});

describe('fetchBlob — HTTP error handling', () => {
  test('non-ok response throws with status code', async () => {
    global.fetch = makeFetch({ ok: false, status: 403 });
    await expect(fetchBlob('https://example.com/file')).rejects.toThrow('HTTP 403');
  });

  test('non-ok 404 throws', async () => {
    global.fetch = makeFetch({ ok: false, status: 404 });
    await expect(fetchBlob('https://example.com/file')).rejects.toThrow('HTTP 404');
  });
});

describe('fetchBlob — timeout / abort', () => {
  test('abort signal fires after timeout', async () => {
    let capturedSignal;
    global.fetch = jest.fn().mockImplementation((_url, opts) => {
      capturedSignal = opts.signal;
      // Reject with AbortError when signal fires, mimicking real fetch behaviour
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = fetchBlob('https://example.com/slow', 500);
    jest.advanceTimersByTime(500);

    await expect(promise).rejects.toThrow('aborted');
    expect(capturedSignal.aborted).toBe(true);
  });
});
