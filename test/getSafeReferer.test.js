const { getSafeReferer } = require('../popup');

describe('getSafeReferer', () => {
  // ── Valid URLs ───────────────────────────────────────────────────
  test('http URL is returned as-is', () => {
    expect(getSafeReferer('http://example.com/path')).toBe('http://example.com/path');
  });

  test('https URL is returned as-is', () => {
    expect(getSafeReferer('https://drive.google.com/file/d/abc')).toBe('https://drive.google.com/file/d/abc');
  });

  test('URL with query string is preserved', () => {
    expect(getSafeReferer('https://example.com/path?a=1&b=2')).toBe('https://example.com/path?a=1&b=2');
  });

  // ── Hash stripping ───────────────────────────────────────────────
  test('hash fragment is stripped', () => {
    expect(getSafeReferer('https://example.com/page#section')).toBe('https://example.com/page');
  });

  test('URL with both query and hash — hash stripped, query preserved', () => {
    expect(getSafeReferer('https://example.com/page?x=1#anchor')).toBe('https://example.com/page?x=1');
  });

  // ── Blocked protocols ────────────────────────────────────────────
  test('file:// URL returns null', () => {
    expect(getSafeReferer('file:///Users/foo/bar.html')).toBeNull();
  });

  test('chrome-extension:// URL returns null', () => {
    expect(getSafeReferer('chrome-extension://abcdef/popup.html')).toBeNull();
  });

  test('javascript: URL returns null', () => {
    expect(getSafeReferer('javascript:void(0)')).toBeNull();
  });

  test('data: URL returns null', () => {
    expect(getSafeReferer('data:text/html,<h1>hi</h1>')).toBeNull();
  });

  // ── Invalid input ────────────────────────────────────────────────
  test('plain string (not a URL) returns null', () => {
    expect(getSafeReferer('not a url')).toBeNull();
  });

  test('empty string returns null', () => {
    expect(getSafeReferer('')).toBeNull();
  });

  test('null returns null', () => {
    expect(getSafeReferer(null)).toBeNull();
  });

  test('undefined returns null', () => {
    expect(getSafeReferer(undefined)).toBeNull();
  });
});
