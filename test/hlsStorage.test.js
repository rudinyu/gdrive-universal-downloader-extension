const Storage = require('../hls-storage.js');

const makeOpfs = () => {
  const files = new Map();
  const directory = {
    getFileHandle: jest.fn(async name => {
      const file = {
        name,
        blob: null,
        createWritable: jest.fn(async () => {
          const writes = [];
          const writer = {
            write: jest.fn(async data => writes.push(data.slice())),
            close: jest.fn(async () => { file.blob = new Blob(writes); }),
            abort: jest.fn(async () => { writes.length = 0; }),
          };
          file.writer = writer;
          return writer;
        }),
        getFile: jest.fn(async () => file.blob),
      };
      files.set(name, file);
      return file;
    }),
    removeEntry: jest.fn(async name => {
      if (!files.has(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      files.delete(name);
    }),
  };
  return { files, directory, navigator: { storage: { getDirectory: jest.fn(async () => directory) } } };
};

test('streams OPFS output incrementally and finalizes a file without loading IndexedDB chunks', async () => {
  const opfs = makeOpfs();
  const appendChunk = jest.fn();
  const getChunks = jest.fn();
  const manager = Storage.createOutputManager({ navigator: opfs.navigator, appendChunk, getChunks });
  const jobId = '123e4567-e89b-12d3-a456-426614174100';

  await expect(manager.createOutput(jobId, { fallbackMaxBytes: 10, opfsMaxBytes: 100 }))
    .resolves.toEqual({ kind: 'opfs', maxBytes: 100 });
  await manager.appendOutputChunk(jobId, 0, new Uint8Array([1, 2]));
  await manager.appendOutputChunk(jobId, 2, new Uint8Array([3, 4, 5]));
  const result = await manager.finishOutput(jobId);

  expect(result.kind).toBe('opfs');
  expect(result.size).toBe(5);
  expect(result.file.size).toBe(5);
  expect(result.file.slice(0, result.file.size, 'video/mp4').type).toBe('video/mp4');
  expect(opfs.files.get(`gud-hls-${jobId}.mp4`).writer.write).toHaveBeenCalledTimes(2);
  expect(appendChunk).not.toHaveBeenCalled();
  expect(getChunks).not.toHaveBeenCalled();
});

test('uses bounded IndexedDB chunks when OPFS is unavailable', async () => {
  const chunks = [];
  const manager = Storage.createOutputManager({
    navigator: { storage: {} },
    appendChunk: jest.fn(async (jobId, offset, bytes) => chunks.push({ jobId, offset, data: bytes.slice() })),
    getChunks: jest.fn(async () => chunks.slice()),
  });
  const jobId = '123e4567-e89b-12d3-a456-426614174101';

  await expect(manager.createOutput(jobId, { fallbackMaxBytes: 4, opfsMaxBytes: 100 }))
    .resolves.toEqual({ kind: 'idb', maxBytes: 4 });
  await manager.appendOutputChunk(jobId, 0, new Uint8Array([1, 2]));
  await manager.appendOutputChunk(jobId, 2, new Uint8Array([3, 4]));
  await expect(manager.appendOutputChunk(jobId, 4, new Uint8Array([5])))
    .rejects.toMatchObject({ code: 'HLS_LIMIT' });
  const result = await manager.finishOutput(jobId);

  expect(result).toMatchObject({ kind: 'idb', size: 4 });
  expect(result.chunks.map(chunk => chunk.offset)).toEqual([0, 2]);
});

test('enforces the 192 MiB IndexedDB and 4 GiB OPFS caps even if callers request more', async () => {
  const fallback = Storage.createOutputManager({
    navigator: { storage: {} },
    appendChunk: jest.fn(),
    getChunks: jest.fn(),
  });
  const fallbackId = '123e4567-e89b-12d3-a456-426614174103';
  await expect(fallback.createOutput(fallbackId, { fallbackMaxBytes: 500 * 1024 * 1024 }))
    .resolves.toEqual({ kind: 'idb', maxBytes: 192 * 1024 * 1024 });

  const opfs = makeOpfs();
  const streaming = Storage.createOutputManager({ navigator: opfs.navigator });
  const opfsId = '123e4567-e89b-12d3-a456-426614174104';
  await expect(streaming.createOutput(opfsId, { fallbackMaxBytes: 500 * 1024 * 1024, opfsMaxBytes: 8 * 1024 * 1024 * 1024 }))
    .resolves.toEqual({ kind: 'opfs', maxBytes: 4 * 1024 * 1024 * 1024 });
});

test('maps OPFS quota failures and aborts/removes partial files during cleanup', async () => {
  const opfs = makeOpfs();
  const manager = Storage.createOutputManager({
    navigator: opfs.navigator,
    appendChunk: jest.fn(),
    getChunks: jest.fn(),
  });
  const jobId = '123e4567-e89b-12d3-a456-426614174102';
  await manager.createOutput(jobId, { fallbackMaxBytes: 4, opfsMaxBytes: 100 });
  const file = opfs.files.get(`gud-hls-${jobId}.mp4`);
  file.writer.write.mockRejectedValue(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));

  await expect(manager.appendOutputChunk(jobId, 0, new Uint8Array([1])))
    .rejects.toMatchObject({ code: 'HLS_QUOTA' });
  await manager.deleteOutput(jobId);

  expect(file.writer.abort).toHaveBeenCalledTimes(1);
  expect(opfs.directory.removeEntry).toHaveBeenCalledWith(`gud-hls-${jobId}.mp4`);
  expect(opfs.files.has(`gud-hls-${jobId}.mp4`)).toBe(false);
});
