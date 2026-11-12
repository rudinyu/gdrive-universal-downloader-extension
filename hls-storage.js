// IndexedDB hands jobs from the popup to a durable tab. OPFS streams MP4
// output to disk; older browsers use bounded IndexedDB chunks instead.
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GUDHlsStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DB_NAME = 'gud-hls-jobs';
  const DB_VERSION = 1;
  const IDB_OUTPUT_MAX_BYTES = 192 * 1024 * 1024;
  const OPFS_OUTPUT_MAX_BYTES = 4 * 1024 * 1024 * 1024;
  const outputFilename = jobId => `gud-hls-${jobId}.mp4`;
  const makeError = (message, code, cause) => Object.assign(new Error(message), { code, cause });
  const isOpfsUnavailable = error => ['NotSupportedError', 'NotAllowedError', 'SecurityError', 'TypeError'].includes(error?.name);
  const isQuotaError = error => error?.name === 'QuotaExceededError' || error?.code === 'HLS_QUOTA';

  const makeOutputManager = (environment = {}) => {
    const navigatorApi = environment.navigator || root?.navigator;
    const appendChunk = environment.appendChunk;
    const getChunks = environment.getChunks;
    const sessions = new Map();

    const getDirectory = async () => {
      const storage = navigatorApi?.storage;
      if (typeof storage?.getDirectory !== 'function') return null;
      try {
        const directory = await storage.getDirectory();
        return typeof directory?.getFileHandle === 'function' ? directory : null;
      } catch (error) {
        if (isOpfsUnavailable(error)) return null;
        throw makeError('Could not access browser file storage.', 'HLS_STORAGE', error);
      }
    };

    const fallbackSession = (jobId, maxBytes) => {
      if (typeof appendChunk !== 'function' || typeof getChunks !== 'function') {
        throw makeError('IndexedDB output storage is unavailable.', 'HLS_STORAGE');
      }
      const session = { kind: 'idb', jobId, maxBytes, size: 0 };
      sessions.set(jobId, session);
      return { kind: session.kind, maxBytes: session.maxBytes };
    };

    const createOutput = async (jobId, limits = {}) => {
      if (typeof jobId !== 'string' || !/^[0-9a-f-]{30,40}$/i.test(jobId)) {
        throw makeError('The HLS output job ID is invalid.', 'HLS_STORAGE');
      }
      await deleteOutput(jobId);
      const boundedLimit = (value, fallback, maximum) =>
        Math.min(maximum, Math.max(1, Math.floor(Number(value) || fallback)));
      const fallbackMaxBytes = boundedLimit(limits.fallbackMaxBytes, IDB_OUTPUT_MAX_BYTES, IDB_OUTPUT_MAX_BYTES);
      const opfsMaxBytes = Math.max(fallbackMaxBytes,
        boundedLimit(limits.opfsMaxBytes, OPFS_OUTPUT_MAX_BYTES, OPFS_OUTPUT_MAX_BYTES));
      const directory = await getDirectory();
      if (!directory) return fallbackSession(jobId, fallbackMaxBytes);

      let fileHandle = null;
      try {
        fileHandle = await directory.getFileHandle(outputFilename(jobId), { create: true });
        const writable = await fileHandle.createWritable({ keepExistingData: false });
        const session = { kind: 'opfs', jobId, maxBytes: opfsMaxBytes, size: 0, directory, fileHandle, writable };
        sessions.set(jobId, session);
        return { kind: session.kind, maxBytes: session.maxBytes };
      } catch (error) {
        if (fileHandle && typeof directory.removeEntry === 'function') await directory.removeEntry(outputFilename(jobId)).catch(() => {});
        if (isOpfsUnavailable(error)) return fallbackSession(jobId, fallbackMaxBytes);
        throw makeError(isQuotaError(error) ? 'Browser storage is full.' : 'Could not create the HLS output file.',
          isQuotaError(error) ? 'HLS_QUOTA' : 'HLS_STORAGE', error);
      }
    };

    const appendOutputChunk = async (jobId, offset, bytes) => {
      const session = sessions.get(jobId);
      if (!session || session.kind === 'opfs' && !session.writable) {
        throw makeError('The HLS output file is not open.', 'HLS_STORAGE');
      }
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || offset !== session.size) {
        throw makeError('HLS output chunks were not written in order.', 'HLS_STORAGE');
      }
      if (session.size + bytes.byteLength > session.maxBytes) {
        throw makeError('Output exceeds the selected browser storage limit.', 'HLS_LIMIT');
      }
      try {
        if (session.kind === 'opfs') await session.writable.write(bytes);
        else await appendChunk(jobId, offset, bytes);
        session.size += bytes.byteLength;
      } catch (error) {
        throw makeError(isQuotaError(error) ? 'Browser storage is full. Free disk space and retry.' : 'Could not save the MP4 output.',
          isQuotaError(error) ? 'HLS_QUOTA' : 'HLS_STORAGE', error);
      }
    };

    const finishOutput = async jobId => {
      const session = sessions.get(jobId);
      if (!session) throw makeError('The HLS output file is not open.', 'HLS_STORAGE');
      if (session.kind === 'opfs') {
        try {
          await session.writable.close();
          session.writable = null;
          const file = await session.fileHandle.getFile();
          if (file.size !== session.size) throw makeError('The saved MP4 size did not match its validated chunks.', 'HLS_INVALID_OUTPUT');
          return { kind: 'opfs', size: session.size, file };
        } catch (error) {
          if (error?.code) throw error;
          throw makeError(isQuotaError(error) ? 'Browser storage is full. Free disk space and retry.' : 'Could not finalize the MP4 output file.',
            isQuotaError(error) ? 'HLS_QUOTA' : 'HLS_STORAGE', error);
        }
      }
      const chunks = await getChunks(jobId);
      return { kind: 'idb', size: session.size, chunks };
    };

    const deleteOutput = async jobId => {
      const session = sessions.get(jobId);
      sessions.delete(jobId);
      if (session?.writable) {
        try { await session.writable.abort(); } catch { /* already closed or browser is shutting down */ }
      }
      const directory = session?.directory || await getDirectory().catch(() => null);
      if (!directory || typeof directory.removeEntry !== 'function') return;
      try { await directory.removeEntry(outputFilename(jobId)); }
      catch (error) { if (error?.name !== 'NotFoundError') throw error; }
    };

    return { createOutput, appendOutputChunk, finishOutput, deleteOutput };
  };

  const open = () => new Promise((resolve, reject) => {
    const indexedDbApi = root?.indexedDB;
    if (typeof indexedDbApi === 'undefined') return reject(new Error('IndexedDB is unavailable.'));
    const request = indexedDbApi.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const chunks = db.createObjectStore('chunks', { keyPath: ['jobId', 'offset'] });
        chunks.createIndex('byJob', 'jobId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Could not open HLS job storage.'));
    request.onblocked = () => reject(new Error('HLS job storage is busy. Close another downloader tab and retry.'));
  });

  const requestValue = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error?.name === 'QuotaExceededError'
      ? makeError('Browser storage is full. Free disk space and retry.', 'HLS_QUOTA', request.error)
      : new Error('HLS job storage request failed.'));
  });

  const transactionDone = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error?.name === 'QuotaExceededError'
      ? makeError('Browser storage is full. Free disk space and retry.', 'HLS_QUOTA', transaction.error)
      : new Error('HLS job storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error?.name === 'QuotaExceededError'
      ? makeError('Browser storage is full. Free disk space and retry.', 'HLS_QUOTA', transaction.error)
      : new Error('HLS job storage transaction was cancelled.'));
  });

  const putJob = async job => {
    const db = await open();
    try {
      const transaction = db.transaction('jobs', 'readwrite');
      transaction.objectStore('jobs').put(job);
      await transactionDone(transaction);
    } finally { db.close(); }
  };

  const getJob = async id => {
    const db = await open();
    try {
      const transaction = db.transaction('jobs', 'readonly');
      const value = await requestValue(transaction.objectStore('jobs').get(id));
      await transactionDone(transaction);
      return value || null;
    } finally { db.close(); }
  };

  const updateJob = async (id, updates) => {
    const db = await open();
    try {
      const transaction = db.transaction('jobs', 'readwrite');
      const store = transaction.objectStore('jobs');
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) store.put({ ...request.result, ...updates });
      };
      await transactionDone(transaction);
    } finally { db.close(); }
  };

  const appendChunk = async (jobId, offset, bytes) => {
    const db = await open();
    try {
      const transaction = db.transaction('chunks', 'readwrite');
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      transaction.objectStore('chunks').put({ jobId, offset, data });
      await transactionDone(transaction);
    } finally { db.close(); }
  };

  const getChunks = async jobId => {
    const db = await open();
    try {
      const transaction = db.transaction('chunks', 'readonly');
      const request = transaction.objectStore('chunks').index('byJob').getAll(root.IDBKeyRange.only(jobId));
      const chunks = await requestValue(request);
      await transactionDone(transaction);
      return (chunks || []).sort((left, right) => left.offset - right.offset);
    } finally { db.close(); }
  };

  const outputManager = makeOutputManager({
    navigator: root?.navigator,
    appendChunk,
    getChunks,
  });

  const deleteJob = async jobId => {
    let db = null;
    try {
      db = await open();
      const transaction = db.transaction(['jobs', 'chunks'], 'readwrite');
      transaction.objectStore('jobs').delete(jobId);
      const index = transaction.objectStore('chunks').index('byJob');
      const cursorRequest = index.openCursor(root.IDBKeyRange.only(jobId));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      await transactionDone(transaction);
    } finally {
      db?.close();
      await outputManager.deleteOutput(jobId).catch(() => {});
    }
  };

  return {
    putJob,
    getJob,
    updateJob,
    appendChunk,
    getChunks,
    deleteJob,
    ...outputManager,
    createOutputManager: makeOutputManager,
  };
});
