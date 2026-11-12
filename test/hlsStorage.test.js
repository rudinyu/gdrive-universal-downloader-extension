const Storage = require('../hls-storage.js');

const makeFakeIndexedDb = (initialJobs, initialChunks) => {
  const jobs = new Map(initialJobs.map(job => [job.id, { ...job }]));
  const chunks = initialChunks.map(chunk => ({ ...chunk }));
  const compareKeys = (left, right) => {
    const a = Array.isArray(left) ? left : [left];
    const b = Array.isArray(right) ? right : [right];
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if (a[index] === b[index]) continue;
      if (a[index] === undefined) return -1;
      if (b[index] === undefined) return 1;
      return a[index] < b[index] ? -1 : 1;
    }
    return 0;
  };
  const matches = (key, range) => {
    if (Object.prototype.hasOwnProperty.call(range, 'only')) return compareKeys(key, range.only) === 0;
    return compareKeys(key, range.lower) >= 0 && compareKeys(key, range.upper) <= 0;
  };
  const database = {
    close: jest.fn(),
    transaction: jest.fn(() => {
      const transaction = { oncomplete: null, onerror: null, onabort: null };
      let pending = 0;
      let completionScheduled = false;
      const finishIfReady = () => {
        if (pending || completionScheduled) return;
        completionScheduled = true;
        setTimeout(() => transaction.oncomplete?.(), 0);
      };
      const makeRequest = getValue => {
        pending++;
        const request = {};
        setTimeout(() => {
          request.result = getValue();
          request.onsuccess?.();
          pending--;
          finishIfReady();
        }, 0);
        return request;
      };
      const makeCursorRequest = (records, keyForRecord, deleteRecord) => {
        pending++;
        const request = {};
        let position = 0;
        const emit = () => {
          setTimeout(() => {
            const record = records[position];
            if (!record) {
              request.result = undefined;
              request.onsuccess?.();
              pending--;
              finishIfReady();
              return;
            }
            let continued = false;
            request.result = {
              value: record,
              primaryKey: keyForRecord(record),
              delete: () => deleteRecord(record),
              continue: () => { continued = true; position++; emit(); },
            };
            request.onsuccess?.();
            if (!continued) {
              pending--;
              finishIfReady();
            }
          }, 0);
        };
        emit();
        return request;
      };
      transaction.objectStore = name => {
        if (name === 'jobs') return {
          delete: id => jobs.delete(id),
          get: id => makeRequest(() => jobs.get(id)),
          index: indexName => ({
            openCursor: range => {
              const records = [...jobs.values()].filter(job => {
                const value = indexName === 'byStatusHeartbeatAt' ? job.heartbeatAt : job.createdAt;
                return matches([job.status, value], range);
              }).sort((left, right) => compareKeys(
                [left.status, indexName === 'byStatusHeartbeatAt' ? left.heartbeatAt : left.createdAt],
                [right.status, indexName === 'byStatusHeartbeatAt' ? right.heartbeatAt : right.createdAt],
              ));
              return makeCursorRequest(records, job => job.id, () => {});
            },
          }),
        };
        return {
          index: indexName => ({
            openCursor: range => {
              const records = chunks.filter(chunk => indexName === 'byJob' && matches(chunk.jobId, range));
              return makeCursorRequest(records, chunk => [chunk.jobId, chunk.offset], chunk => {
                const index = chunks.indexOf(chunk);
                if (index >= 0) chunks.splice(index, 1);
              });
            },
          }),
        };
      };
      return transaction;
    }),
  };
  return {
    jobs,
    chunks,
    indexedDB: {
      open: jest.fn(() => {
        const request = {};
        setTimeout(() => { request.result = database; request.onsuccess?.(); }, 0);
        return request;
      }),
    },
  };
};

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

test('expires stale jobs while retaining recent and active running jobs', () => {
  const now = 2_000_000_000_000;
  const ttl = Storage.STALE_JOB_TTL_MS || 24 * 60 * 60 * 1000;
  expect(Storage.isStaleJob({ status: 'queued', createdAt: now - ttl - 1 }, now)).toBe(true);
  expect(Storage.isStaleJob({ status: 'failed', createdAt: now - ttl - 1 }, now)).toBe(true);
  expect(Storage.isStaleJob({ status: 'running', heartbeatAt: now - 1000, createdAt: now - ttl * 2 }, now)).toBe(false);
  expect(Storage.isStaleJob({ status: 'running', heartbeatAt: now - ttl - 1, createdAt: now - ttl * 2 }, now)).toBe(true);
  expect(Storage.isStaleJob({ status: 'running', createdAt: now - ttl * 2 }, now)).toBe(true);
  expect(Storage.isStaleJob({ status: 'queued', createdAt: now - 1000 }, now)).toBe(false);
});

test('removes only old orphan OPFS outputs within the bounded sweep', async () => {
  const now = 2_000_000_000_000;
  const old = now - 24 * 60 * 60 * 1000 - 1;
  const activeId = '123e4567-e89b-12d3-a456-426614174111';
  const orphanId = '123e4567-e89b-12d3-a456-426614174112';
  const recentId = '123e4567-e89b-12d3-a456-426614174113';
  const files = new Map([
    [`gud-hls-${activeId}.mp4`, { getFile: async () => ({ lastModified: old }) }],
    [`gud-hls-${orphanId}.mp4`, { getFile: async () => ({ lastModified: old }) }],
    [`gud-hls-${recentId}.mp4`, { getFile: async () => ({ lastModified: now }) }],
  ]);
  const directory = { async *entries() { for (const entry of files) yield entry; } };
  const deleteOutput = jest.fn(async id => files.delete(`gud-hls-${id}.mp4`));
  const cleanup = Storage.makeOrphanOutputCleaner({
    getDirectory: async () => directory,
    getJob: async id => id === activeId ? { id, status: 'running' } : null,
    deleteOutput,
    hasSession: id => id === activeId,
    maxEntries: 1,
  });

  await expect(cleanup(now)).resolves.toBe(0);
  expect(deleteOutput).not.toHaveBeenCalled();

  const removeOrphan = Storage.makeOrphanOutputCleaner({
    getDirectory: async () => directory,
    getJob: async () => null,
    deleteOutput,
    hasSession: id => id === activeId,
    maxEntries: 3,
  });
  await expect(removeOrphan(now)).resolves.toBe(1);
  expect(deleteOutput).toHaveBeenCalledWith(orphanId);
  expect(files.has(`gud-hls-${activeId}.mp4`)).toBe(true);
  expect(files.has(`gud-hls-${recentId}.mp4`)).toBe(true);
});

test('startup cleanup deletes stale IndexedDB fallback chunks and preserves active jobs', async () => {
  const now = 2_000_000_000_000;
  const ttl = Storage.STALE_JOB_TTL_MS;
  const staleId = '123e4567-e89b-12d3-a456-426614174114';
  const activeId = '123e4567-e89b-12d3-a456-426614174115';
  const fake = makeFakeIndexedDb([
    { id: staleId, status: 'queued', createdAt: now - ttl - 1 },
    { id: activeId, status: 'running', createdAt: now - ttl * 2, heartbeatAt: now - 1000 },
  ], [
    { jobId: staleId, offset: 0, data: new Uint8Array([1]) },
    { jobId: staleId, offset: 1, data: new Uint8Array([2]) },
    { jobId: activeId, offset: 0, data: new Uint8Array([3]) },
  ]);
  const previousIndexedDB = global.indexedDB;
  const previousKeyRange = global.IDBKeyRange;
  global.indexedDB = fake.indexedDB;
  global.IDBKeyRange = {
    only: value => ({ only: value }),
    bound: (lower, upper) => ({ lower, upper }),
  };

  try {
    await expect(Storage.cleanupStaleJobs(now)).resolves.toMatchObject({ jobs: 1 });
    expect(fake.jobs.has(staleId)).toBe(false);
    expect(fake.jobs.has(activeId)).toBe(true);
    expect(fake.chunks.map(chunk => chunk.jobId)).toEqual([activeId]);
  } finally {
    if (previousIndexedDB === undefined) delete global.indexedDB;
    else global.indexedDB = previousIndexedDB;
    if (previousKeyRange === undefined) delete global.IDBKeyRange;
    else global.IDBKeyRange = previousKeyRange;
  }
});
