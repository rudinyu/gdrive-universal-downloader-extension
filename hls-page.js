// Durable HLS job UI. The extension tab remains alive after the action popup closes.
(function () {
  'use strict';

  const Core = window.GUDHlsCore;
  const Platform = window.GUDHlsPlatform;
  const Storage = Platform?.storage;
  const sourceLabel = document.getElementById('sourceLabel');
  const filenameInput = document.getElementById('filenameInput');
  const variantSection = document.getElementById('variantSection');
  const variantSelect = document.getElementById('variantSelect');
  const concurrencySelect = document.getElementById('concurrencySelect');
  const startBtn = document.getElementById('startBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const progress = document.getElementById('progress');
  const progressLabel = document.getElementById('progressLabel');
  const status = document.getElementById('status');

  const jobId = new URLSearchParams(location.search).get('job') || '';
  let job = null;
  let controller = null;
  let activeDownloadId = null;
  let selectedVariant = null;
  let pendingPlaylist = null;
  let pendingPlaylistUrl = null;
  let busy = false;
  let autoStartTriggered = false;
  const refererRules = new Map();
  let nextRuleId = 200000 + Math.floor(Math.random() * 300000);

  const setStatus = (message, kind = '') => {
    status.textContent = message;
    status.className = kind;
  };

  const formatBytes = bytes => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  };

  const VIDEO_ONLY_SUFFIX = '-no音訊';
  const sanitizeOutputFilename = (value, fallback, videoOnly = false) => {
    const filename = Core.sanitizeOutputFilename(value, fallback);
    if (!videoOnly) return filename;
    const base = filename.replace(/\.mp4$/i, '');
    return base.endsWith(VIDEO_ONLY_SUFFIX) ? filename : `${base}${VIDEO_ONLY_SUFFIX}.mp4`;
  };

  const assertNotCancelled = signal => {
    if (signal?.aborted) throw new Core.HlsError('Download cancelled.', 'HLS_CANCELLED');
  };

  const requestTabId = async () => {
    try { return await Platform?.tabs.getCurrentId() ?? null; } catch { return null; }
  };

  const ensureRefererRule = async url => {
    await Platform?.permissions.ensureHostAccess(url);
    if (!job?.referer || !Platform?.rules.available) return;
    let hostname;
    try { hostname = new URL(url).hostname; } catch { return; }
    if (refererRules.has(hostname)) return;
    const tabId = await requestTabId();
    if (!Number.isInteger(tabId)) return;
    try {
      const existing = await Platform.rules.getSessionRules();
      const used = new Set((existing || []).map(rule => rule.id));
      while (used.has(nextRuleId) && nextRuleId < 999999) nextRuleId++;
      if (nextRuleId >= 999999) nextRuleId = 200000;
      const ruleId = nextRuleId++;
      await Platform.rules.addSessionRules([{
          id: ruleId,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: job.referer }] },
          condition: { urlFilter: `||${hostname}/`, tabIds: [tabId], resourceTypes: ['xmlhttprequest'] },
        }]);
      refererRules.set(hostname, ruleId);
    } catch { /* A blocked DNR rule should not prevent an ordinary fetch attempt. */ }
  };

  const clearRefererRules = async () => {
    const ids = [...refererRules.values()];
    refererRules.clear();
    if (!ids.length || !Platform?.rules.available) return;
    try { await Platform.rules.removeSessionRules(ids); } catch { /* best-effort cleanup */ }
  };

  const readBounded = async (response, maxBytes, signal) => {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      response.body?.cancel();
      throw new Core.HlsError('A playlist or segment exceeds the supported size limit.', 'HLS_LIMIT');
    }
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Core.HlsError('A playlist or segment exceeds the supported size limit.', 'HLS_LIMIT');
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        assertNotCancelled(signal);
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          throw new Core.HlsError('A playlist or segment exceeds the supported size limit.', 'HLS_LIMIT');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };

  const fetchBytes = async (url, range, signal, maxBytes) => {
    const safeUrl = Core.resolveHttpUrl(url, location.href, 'playlist or segment');
    const rangeHeader = range ? `bytes=${range.offset}-${range.offset + range.length - 1}` : '';
    const isCrossOrigin = new URL(safeUrl).origin !== location.origin;
    let credentialsMode = 'include';
    return Core.requestWithRetry(safeUrl, {
      credentials: 'include',
      // Prevent a public playlist from redirecting the extension request to a
      // private or local address before response.url can be inspected.
      redirect: 'error',
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
      signal,
    }, {
      ensureRefererRule,
      fetchImpl: async (target, options) => {
        const requestOptions = credentialsMode === options.credentials ? options : { ...options, credentials: credentialsMode };
        try {
          return await Platform.network.fetch(target, requestOptions);
        } catch (error) {
          const isAbort = signal?.aborted || error?.name === 'AbortError';
          const isNetworkRejection = error instanceof TypeError || error?.name === 'TypeError';
          if (isNetworkRejection && /redirect/i.test(error?.message || '')) {
            throw new Core.HlsError('HLS redirects are not supported by this downloader.', 'HLS_REDIRECT');
          }
          if (!isCrossOrigin || credentialsMode !== 'include' || isAbort || !isNetworkRejection) throw error;
          // Some CDNs allow credentialed access, while others reject it when
          // Access-Control-Allow-Origin is '*'. Try anonymous access only after
          // fetch rejects; HTTP 403/404 responses are handled without fallback.
          credentialsMode = 'omit';
          return Platform.network.fetch(target, { ...options, credentials: 'omit' });
        }
      },
      processResponse: async response => {
        if (response.status === 206 && !range) throw new Core.HlsError('The server returned an unexpected partial response.', 'HLS_HTTP');
        if (range) {
          const contentRange = response.headers.get('content-range') || '';
          if (response.status !== 206 || !new RegExp(`^bytes ${range.offset}-${range.offset + range.length - 1}/(?:\\d+|\\*)$`, 'i').test(contentRange)) {
            throw new Core.HlsError('The server did not honor an HLS byte-range request.', 'HLS_UNSUPPORTED');
          }
        }
        const finalUrl = Core.resolveHttpUrl(response.url || safeUrl, safeUrl, 'redirected resource');
        const bytes = await readBounded(response, maxBytes, signal);
        if (range && bytes.byteLength !== range.length) throw new Core.HlsError('A byte-range response had the wrong length.', 'HLS_MALFORMED');
        return { bytes, url: finalUrl, contentType: response.headers.get('content-type') || '' };
      },
    });
  };

  const fetchPlaylist = async (url, signal) => {
    const result = await fetchBytes(url, null, signal, Core.LIMITS.MAX_PLAYLIST_BYTES);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(result.bytes);
    if (!text.startsWith('#EXTM3U')) {
      if (/text\/html/i.test(result.contentType)) throw new Core.HlsError('The playlist URL returned an HTML page.', 'HLS_MALFORMED');
      throw new Core.HlsError('The server response is not an HLS playlist.', 'HLS_MALFORMED');
    }
    return { text, url: result.url };
  };

  const variantLabel = variant => {
    const label = variant.resolution ? `${variant.resolution.split('x')[1]}p` : 'Variant';
    const bitrate = variant.bandwidth ? ` · ${(variant.bandwidth / 1000000).toFixed(1)} Mb/s` : '';
    const reason = Core.variantUnsupportedReason(variant);
    const audio = variant.separateAudio ? ' · separate audio available' : variant.audioGroupError ? ' · audio selection unavailable' : '';
    return `${label}${bitrate}${audio}${reason ? ` — ${reason}` : ''}`;
  };

  const parseSupportedMediaPlaylist = (text, url) => {
    const playlist = Core.parseMediaPlaylist(text, url);
    const reason = Core.mediaPlaylistUnsupportedReason(playlist);
    if (reason) throw new Core.HlsError(reason, 'HLS_UNSUPPORTED');
    return playlist;
  };

  const maybeAutoStart = () => {
    if (job?.autoStart === false || autoStartTriggered || busy) return;
    autoStartTriggered = true;
    void start();
  };

  const preparePlaylist = async (playlistUrl, signal, depth = 0) => {
    if (depth > 3) throw new Core.HlsError('Nested HLS playlists exceed the supported depth.', 'HLS_LIMIT');
    const fetched = await fetchPlaylist(playlistUrl, signal);
    if (/#EXT-X-STREAM-INF:/i.test(fetched.text)) {
      const variants = Core.parseMasterPlaylist(fetched.text, fetched.url);
      const choices = variants.filter(variant => !Core.variantUnsupportedReason(variant));
      if (!choices.length) {
        const reasons = [...new Set(variants.map(Core.variantUnsupportedReason).filter(Boolean))];
        throw new Core.HlsError(`No supported variant: ${reasons.join('; ') || 'unsupported MP4 codec or layout'}.`, 'HLS_UNSUPPORTED');
      }
      const next = choices[0];
      const prepared = await preparePlaylist(next.url, signal, depth + 1);
      if (next.audioRendition?.url) {
        if (prepared.audioPlaylist || prepared.audioError) {
          prepared.audioPlaylist = null;
          prepared.audioError = new Core.HlsError('Nested HLS masters select multiple separate audio renditions, which cannot be combined safely.', 'HLS_UNSUPPORTED');
        } else {
          try { prepared.audioPlaylist = await prepareAudioPlaylist(next.audioRendition.url, signal); }
          catch (error) { prepared.audioError = error; }
        }
      }
      return prepared;
    }
    return { playlist: parseSupportedMediaPlaylist(fetched.text, fetched.url), url: fetched.url };
  };

  const prepareAudioPlaylist = async (playlistUrl, signal) => {
    const fetched = await fetchPlaylist(playlistUrl, signal);
    if (/#EXT-X-STREAM-INF:/i.test(fetched.text)) {
      throw new Core.HlsError('Nested master playlists for separate audio are not supported.', 'HLS_UNSUPPORTED');
    }
    const playlist = parseSupportedMediaPlaylist(fetched.text, fetched.url);
    if (playlist.container !== 'fmp4') {
      throw new Core.HlsError('Separate audio and video must both use fragmented MP4.', 'HLS_UNSUPPORTED');
    }
    return playlist;
  };

  const displayVariants = variants => {
    variantSection.classList.remove('hidden');
    variantSelect.replaceChildren();
    const supported = [];
    variants.forEach((variant, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = variantLabel(variant);
      const reason = Core.variantUnsupportedReason(variant);
      option.disabled = !!reason;
      if (!reason) supported.push({ variant, index });
      variantSelect.appendChild(option);
    });
    selectedVariant = variants;
    if (supported.length) {
      variantSelect.value = String(supported[0].index);
      startBtn.disabled = false;
      setStatus(job?.autoStart === false
        ? 'Choose a supported variant, then start the download.'
        : 'Highest supported variant selected. Starting download…');
    } else {
      startBtn.disabled = true;
      const reasons = [...new Set(variants.map(Core.variantUnsupportedReason).filter(Boolean))];
      setStatus(`This master playlist has no supported variant. ${reasons.join('; ') || 'Unsupported MP4 codec or layout.'}`, 'error');
    }
    return supported.length > 0;
  };

  const loadJob = async () => {
    if (!Platform?.storage?.createOutput || !Platform?.downloads?.download) {
      throw new Core.HlsError('The browser extension platform adapter could not be loaded.', 'HLS_PLATFORM');
    }
    if (!/^[0-9a-f-]{30,40}$/i.test(jobId)) throw new Core.HlsError('This HLS job link is invalid.', 'HLS_JOB');
    job = await Storage.getJob(jobId);
    if (!job || typeof job.playlistUrl !== 'string') throw new Core.HlsError('The selected HLS job could not be found. Start it again from the extension popup.', 'HLS_JOB');
    const initialUrl = Core.resolveHttpUrl(job.playlistUrl, location.href, 'playlist');
    const host = new URL(initialUrl).hostname;
    sourceLabel.textContent = `Selected playlist on ${host}`;
    filenameInput.value = Core.sanitizeOutputFilename(job.title);
    document.title = `HLS Downloader — ${filenameInput.value.replace(/\.mp4$/i, '')}`;
    controller = new AbortController();
    const result = await fetchPlaylist(initialUrl, controller.signal);
    pendingPlaylistUrl = result.url;
    if (/#EXT-X-STREAM-INF:/i.test(result.text)) {
      const variants = Core.parseMasterPlaylist(result.text, result.url);
      if (displayVariants(variants)) maybeAutoStart();
      return;
    }
    pendingPlaylist = parseSupportedMediaPlaylist(result.text, result.url);
    setStatus(job.autoStart === false
      ? `${pendingPlaylist.segments.length.toLocaleString()} finished segments are ready.`
      : 'Playlist is ready. Starting download…');
    startBtn.disabled = false;
    maybeAutoStart();
  };

  const finishDownload = async (blob, filename, signal) => {
    if (!Platform?.downloads?.download) throw new Core.HlsError('Browser downloads are unavailable.', 'HLS_DOWNLOAD');
    assertNotCancelled(signal);
    const objectUrl = URL.createObjectURL(blob);
    const finished = new Map();
    let resolveEnd;
    let rejectEnd;
    let timeout = null;
    let settled = false;
    const ended = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
    // The downloads API can stay pending after abort. Keep its eventual
    // rejection observed until the API resolves and the caller reaches await.
    void ended.catch(() => {});
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      Platform.downloads.onChanged.removeListener(onChanged);
      signal?.removeEventListener('abort', onAbort);
      error ? rejectEnd(error) : resolveEnd();
    };
    const onChanged = delta => {
      if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
        finished.set(delta.id, delta);
        if (delta.id === activeDownloadId) {
          if (delta.state.current === 'complete') settle();
          else settle(new Core.HlsError('The browser interrupted the file download.', 'HLS_DOWNLOAD'));
        }
      }
    };
    const onAbort = () => {
      if (activeDownloadId !== null) Platform.downloads.cancel(activeDownloadId).catch(() => {});
      settle(new Core.HlsError('Download cancelled.', 'HLS_CANCELLED'));
    };
    Platform.downloads.onChanged.addListener(onChanged);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      activeDownloadId = await Platform.downloads.download({ url: objectUrl, filename, saveAs: false });
      if (signal?.aborted) {
        await Platform.downloads.cancel(activeDownloadId).catch(() => {});
        assertNotCancelled(signal);
      }
      assertNotCancelled(signal);
      if (finished.has(activeDownloadId)) {
        const delta = finished.get(activeDownloadId);
        if (delta.state.current === 'complete') settle();
        else settle(new Core.HlsError('The browser interrupted the file download.', 'HLS_DOWNLOAD'));
      } else {
        try {
          const [item] = await Platform.downloads.search({ id: activeDownloadId });
          assertNotCancelled(signal);
          if (item?.state === 'complete') settle();
          else if (item?.state === 'interrupted') settle(new Core.HlsError('The browser interrupted the file download.', 'HLS_DOWNLOAD'));
        } catch { /* onChanged remains the completion signal */ }
      }
      timeout = setTimeout(() => settle(new Core.HlsError('Timed out while waiting for the browser to save the MP4.', 'HLS_DOWNLOAD')), 30 * 60 * 1000);
      await ended;
    } finally {
      Platform.downloads.onChanged.removeListener(onChanged);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      activeDownloadId = null;
    }
  };

  const start = async () => {
    if (busy) return;
    busy = true;
    let completed = false;
    let heartbeatTimer = null;
    startBtn.disabled = true;
    cancelBtn.classList.remove('hidden');
    cancelBtn.disabled = false;
    filenameInput.disabled = true;
    progress.classList.remove('hidden');
    progress.value = 0;
    progressLabel.textContent = '';
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      await Storage.deleteJob(jobId);
      assertNotCancelled(signal);
      await Storage.putJob({ ...job, status: 'running', startedAt: Date.now() });
      assertNotCancelled(signal);
      heartbeatTimer = window.setInterval(() => {
        void Storage.updateJob(jobId, { heartbeatAt: Date.now() }).catch(() => {});
      }, 60 * 1000);
      const outputLimits = {
        fallbackMaxBytes: Core.LIMITS.MAX_OUTPUT_BYTES,
        opfsMaxBytes: Core.LIMITS.MAX_OPFS_OUTPUT_BYTES,
      };
      let outputSession = await Storage.createOutput(jobId, outputLimits);
      assertNotCancelled(signal);
      const canFallBackToVideo = error => !signal.aborted && error?.name !== 'QuotaExceededError' &&
        !['HLS_CANCELLED', 'HLS_PERMISSION', 'HLS_QUOTA', 'HLS_STORAGE'].includes(error?.code);
      const recordAudioFailure = error => {
        if (!canFallBackToVideo(error)) throw error;
        audioFallbackReason = error?.message || 'Separate audio is unavailable.';
      };
      setStatus('Preparing the selected variant…');
      let media = pendingPlaylist;
      let audioMedia = null;
      let audioFallbackReason = '';
      if (!media) {
        const index = Number(variantSelect.value);
        const variant = selectedVariant?.[index];
        if (!variant || Core.variantUnsupportedReason(variant)) throw new Core.HlsError('Choose a supported video variant.', 'HLS_UNSUPPORTED');
        const prepared = await preparePlaylist(variant.url, signal);
        assertNotCancelled(signal);
        media = prepared.playlist;
        const hasNestedAudioSelection = !!prepared.audioPlaylist || !!prepared.audioError;
        if (prepared.audioError) recordAudioFailure(prepared.audioError);
        else audioMedia = prepared.audioPlaylist || null;
        if (variant.audioRendition?.url) {
          if (hasNestedAudioSelection) {
            recordAudioFailure(new Core.HlsError('Nested HLS masters select multiple separate audio renditions, which cannot be combined safely.', 'HLS_UNSUPPORTED'));
            audioMedia = null;
          } else {
            try { audioMedia = await prepareAudioPlaylist(variant.audioRendition.url, signal); }
            catch (error) { recordAudioFailure(error); }
            assertNotCancelled(signal);
          }
        }
      }
      assertNotCancelled(signal);
      let totalSegments = media.segments.length + (audioMedia?.segments.length || 0);
      const resetOutput = async () => {
        await Storage.deleteJob(jobId);
        assertNotCancelled(signal);
        await Storage.putJob({ ...job, status: 'running', startedAt: Date.now() });
        assertNotCancelled(signal);
        const session = await Storage.createOutput(jobId, outputLimits);
        assertNotCancelled(signal);
        return session;
      };
      if (audioFallbackReason) {
        totalSegments = media.segments.length;
        setStatus('Separate audio is unavailable; downloading video only.');
        outputSession = await resetOutput();
      } else {
        setStatus(`Downloading ${totalSegments.toLocaleString()} media segments…`);
      }
      const downloadOptions = {
        signal,
        concurrency: Number(concurrencySelect.value),
        maxOutputBytes: outputSession.maxBytes,
        muxjs: window.muxjs,
        fetchBytes: async (url, range, requestSignal) => {
          const response = await fetchBytes(url, range, requestSignal, Core.LIMITS.MAX_SEGMENT_BYTES);
          return response.bytes;
        },
        appendChunk: (bytes, offset) => Storage.appendOutputChunk(jobId, offset, bytes),
        onProgress: ({ completed, total, bytes }) => {
          const percent = Math.floor((completed / total) * 100);
          progress.value = percent;
          progressLabel.textContent = `${completed.toLocaleString()} / ${total.toLocaleString()} segments · ${formatBytes(bytes)} read`;
          if (completed === total || completed % 10 === 0) setStatus(`Downloading HLS media… ${percent}%`);
        },
      };
      let result;
      if (audioMedia) {
        try {
          result = await Core.downloadSeparateFmp4Playlists(media, audioMedia, downloadOptions);
        } catch (error) {
          if (!error?.hlsAudioFallback || !canFallBackToVideo(error)) throw error;
          audioFallbackReason = error.message || 'Separate audio could not be combined.';
          audioMedia = null;
          totalSegments = media.segments.length;
          progress.value = 0;
          progressLabel.textContent = '';
          setStatus('Separate audio could not be combined; restarting with video only.');
          outputSession = await resetOutput();
          downloadOptions.maxOutputBytes = outputSession.maxBytes;
          result = await Core.downloadMediaPlaylist(media, downloadOptions);
        }
      } else {
        result = await Core.downloadMediaPlaylist(media, downloadOptions);
      }
      assertNotCancelled(signal);
      setStatus('Validating MP4 fragments…');
      const output = await Storage.finishOutput(jobId);
      assertNotCancelled(signal);
      if (output.size !== result.bytes || output.size <= 0) throw new Core.HlsError('Saved MP4 size does not match its validated output.', 'HLS_INVALID_OUTPUT');
      const blob = output.kind === 'opfs'
        ? output.file.slice(0, output.file.size, 'video/mp4')
        : new Blob(output.chunks.map(record => record.data), { type: 'video/mp4' });
      setStatus(`Saving ${formatBytes(result.bytes)} MP4…`);
      const isVideoOnly = result.hasAudio !== true;
      const outputFilename = sanitizeOutputFilename(filenameInput.value, job.title, isVideoOnly);
      filenameInput.value = outputFilename;
      assertNotCancelled(signal);
      await finishDownload(blob, outputFilename, signal);
      assertNotCancelled(signal);
      await Storage.deleteJob(jobId);
      assertNotCancelled(signal);
      completed = true;
      controller = null;
      cancelBtn.disabled = true;
      progress.value = 100;
      if (isVideoOnly) {
        setStatus('Video-only MP4 download completed. No audio track was included.', 'ok');
        progressLabel.textContent = `No audio · ${formatBytes(result.bytes)} · ${result.segments.toLocaleString()} segments`;
      } else if (audioFallbackReason && result.hasAudio) {
        setStatus('MP4 download completed. Audio from the video stream was retained.', 'ok');
        progressLabel.textContent = `${formatBytes(result.bytes)} · ${result.segments.toLocaleString()} segments`;
      } else {
        setStatus('MP4 download completed.', 'ok');
        progressLabel.textContent = `${formatBytes(result.bytes)} · ${result.segments.toLocaleString()} segments`;
      }
    } catch (error) {
      const cancelled = signal.aborted || error?.code === 'HLS_CANCELLED';
      if (cancelled) {
        await Storage.deleteJob(jobId).catch(() => {});
        setStatus('Download cancelled.', 'error');
      } else {
        const knownStorageError = ['HLS_QUOTA', 'HLS_STORAGE'].includes(error?.code);
        setStatus(error instanceof Core.HlsError || knownStorageError
          ? error.message
          : 'Download failed. Check that the link is still available and the site permits extension access.', 'error');
        await Storage.updateJob(jobId, { status: 'failed', lastErrorCode: error?.code || 'HLS_ERROR' }).catch(() => {});
        // Keep the in-memory `job` and parsed playlist so Start can retry, but
        // remove signed URLs and partial output from persistent storage.
        await Storage.deleteJob(jobId).catch(() => {});
      }
    } finally {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      await clearRefererRules();
      busy = false;
      cancelBtn.classList.add('hidden');
      cancelBtn.disabled = false;
      filenameInput.disabled = completed;
      startBtn.disabled = completed || !!(selectedVariant && !selectedVariant.some(variant => !Core.variantUnsupportedReason(variant)));
      startBtn.textContent = completed ? 'Download completed' : 'Start download';
      if (pendingPlaylist && !completed) startBtn.disabled = false;
      controller = null;
      activeDownloadId = null;
    }
  };

  const cancel = () => {
    if (!controller) return;
    controller.abort();
    if (activeDownloadId !== null) Platform.downloads.cancel(activeDownloadId).catch(() => {});
    cancelBtn.disabled = true;
  };

  startBtn.addEventListener('click', start);
  cancelBtn.addEventListener('click', cancel);
  variantSelect.addEventListener('change', () => {
    const variant = selectedVariant?.[Number(variantSelect.value)];
    startBtn.disabled = !variant || !!Core.variantUnsupportedReason(variant);
  });
  Platform?.lifecycle.onPageClose(() => {
    controller?.abort();
    void clearRefererRules();
    void Storage?.deleteJob(jobId).catch(() => {});
  });

  loadJob().catch(error => {
    const knownStorageError = ['HLS_QUOTA', 'HLS_STORAGE'].includes(error?.code);
    setStatus(error instanceof Core.HlsError || knownStorageError ? error.message : 'Could not prepare the selected HLS playlist.', 'error');
    startBtn.disabled = true;
    void Storage?.deleteJob(jobId).catch(() => {});
  });
})();
