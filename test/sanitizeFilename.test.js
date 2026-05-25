const { sanitizeFilename, FALLBACK_FILENAME } = require('../popup');

describe('sanitizeFilename', () => {
  // ── Normal cases ────────────────────────────────────────────────
  test('plain filename passes through unchanged', () => {
    expect(sanitizeFilename('report.pdf')).toBe('report.pdf');
  });

  test('filename with spaces is preserved', () => {
    expect(sanitizeFilename('my document.pdf')).toBe('my document.pdf');
  });

  // ── Forbidden characters (replaced with _) ───────────────────────
  test.each([
    ['file<name>.txt',        'file_name_.txt'],
    ['file:name.txt',         'file_name.txt'],
    ['file|name.txt',         'file_name.txt'],
    ['file?name.txt',         'file_name.txt'],
    ['file*name.txt',         'file_name.txt'],
    ['file\x22name.txt',      'file_name.txt'],  // double-quote (U+0022)
  ])('forbidden char in "%s" replaced with _', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  test('all forbidden chars become underscores (not stripped to fallback)', () => {
    expect(sanitizeFilename('<>:|?*')).toBe('______');
  });

  test('DEL character (U+007F) is replaced with _', () => {
    expect(sanitizeFilename('filename.txt')).toBe('file_name.txt');
  });

  test('control characters (U+0000-U+001F) are stripped', () => {
    expect(sanitizeFilename('filename.txt')).toBe('filename.txt');
  });

  // ── Path handling ────────────────────────────────────────────────
  test('forward slash — takes last segment', () => {
    expect(sanitizeFilename('dir/subdir/file.txt')).toBe('file.txt');
  });

  test('backslash — takes last segment', () => {
    expect(sanitizeFilename('dir\\subdir\\file.txt')).toBe('file.txt');
  });

  // ── Leading dots ─────────────────────────────────────────────────
  test('leading dot stripped', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
  });

  test('multiple leading dots stripped', () => {
    expect(sanitizeFilename('...file.txt')).toBe('file.txt');
  });

  // ── Whitespace ───────────────────────────────────────────────────
  test('multiple spaces collapsed to single space', () => {
    expect(sanitizeFilename('file   name.txt')).toBe('file name.txt');
  });

  test('leading/trailing whitespace trimmed', () => {
    expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
  });

  // ── Length truncation ────────────────────────────────────────────
  test('name exactly 180 chars is not truncated', () => {
    const name = 'a'.repeat(180);
    expect(sanitizeFilename(name)).toHaveLength(180);
  });

  test('name over 180 chars is truncated to 180', () => {
    const name = 'a'.repeat(200);
    expect(sanitizeFilename(name)).toHaveLength(180);
  });

  test('long name with extension — extension preserved after truncation', () => {
    const name = 'a'.repeat(200) + '.pdf';
    const result = sanitizeFilename(name);
    expect(result.endsWith('.pdf')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(180);
  });

  // ── Fallback ─────────────────────────────────────────────────────
  test('empty string returns fallback', () => {
    expect(sanitizeFilename('')).toBe(FALLBACK_FILENAME);
  });

  test('null returns fallback', () => {
    expect(sanitizeFilename(null)).toBe(FALLBACK_FILENAME);
  });

  test('undefined returns fallback', () => {
    expect(sanitizeFilename(undefined)).toBe(FALLBACK_FILENAME);
  });

  test('only whitespace (collapses to empty) returns fallback', () => {
    expect(sanitizeFilename('   ')).toBe(FALLBACK_FILENAME);
  });

  test('custom fallback is used when name is empty', () => {
    expect(sanitizeFilename('', 'fallback.bin')).toBe('fallback.bin');
  });

  // ── Security ─────────────────────────────────────────────────────
  test('directory traversal — path separators yield last segment', () => {
    const result = sanitizeFilename('../../etc/passwd');
    expect(result).toBe('passwd');
    expect(result).not.toContain('..');
    expect(result).not.toContain('/');
  });
});
