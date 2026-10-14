export interface MseBufferLimits {
  aheadSeconds: number;
  behindSeconds: number;
  maxBytes: number;
  pollMs?: number;
}

const aborted = () => new DOMException("MSE stream superseded", "AbortError");

function wait(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      cleanup();
      reject(aborted());
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function update(
  buffer: SourceBuffer,
  signal: AbortSignal,
  operation: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const cleanup = () => {
      buffer.removeEventListener("updateend", done);
      buffer.removeEventListener("error", failed);
      buffer.removeEventListener("abort", failed);
      signal.removeEventListener("abort", cancel);
    };
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("Media buffer update failed"));
    };
    const cancel = () => {
      cleanup();
      reject(aborted());
    };
    buffer.addEventListener("updateend", done);
    buffer.addEventListener("error", failed);
    buffer.addEventListener("abort", failed);
    signal.addEventListener("abort", cancel, { once: true });
    try {
      operation();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** One read/append at a time: no accumulating queue of downloaded movie bytes. */
export async function pumpMseStream({
  reader,
  buffer,
  mediaSource,
  video,
  signal,
  limits,
}: {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  buffer: SourceBuffer;
  mediaSource: MediaSource;
  video: Pick<HTMLVideoElement, "currentTime">;
  signal: AbortSignal;
  limits: MseBufferLimits;
}): Promise<void> {
  const retained: { end: number; bytes: number }[] = [];
  let aheadBytes = 0;
  let removedThrough = 0;
  const cancelReader = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancelReader, { once: true });
  const end = () =>
    buffer.buffered.length
      ? buffer.buffered.end(buffer.buffered.length - 1)
      : 0;
  const ahead = () => {
    if (!buffer.buffered.length) return 0;
    // Remux timestamps can start above zero during a seek/preroll.
    return Math.max(
      0,
      end() - Math.max(video.currentTime, buffer.buffered.start(0)),
    );
  };
  const prune = async () => {
    while (retained.length && retained[0].end <= video.currentTime)
      aheadBytes -= retained.shift()!.bytes;
    const cutoff = Math.max(0, video.currentTime - limits.behindSeconds);
    if (
      !buffer.buffered.length ||
      buffer.updating ||
      cutoff <= removedThrough + 1 ||
      buffer.buffered.start(0) >= cutoff
    )
      return;
    await update(buffer, signal, () => buffer.remove(0, cutoff));
    removedThrough = cutoff;
  };
  try {
    while (!signal.aborted && mediaSource.readyState === "open") {
      await prune();
      // The byte budget counts unplayed data; otherwise a high-bitrate stream
      // could stall before reaching the normal back-buffer eviction boundary.
      // Pausing stops reads once either budget is filled. TCP backpressure
      // then slows the local proxy and FFmpeg instead of filling JS memory.
      if (
        aheadBytes >= limits.maxBytes &&
        ahead() < 0.1 &&
        retained.some((entry) => !Number.isFinite(entry.end))
      ) {
        throw new Error(
          "Media fragment exceeds the custom player's buffering limit",
        );
      }
      if (ahead() >= limits.aheadSeconds || aheadBytes >= limits.maxBytes) {
        await wait(signal, limits.pollMs || 200);
        continue;
      }
      const { done, value } = await reader.read();
      if (signal.aborted) throw aborted();
      if (done) {
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
        return;
      }
      if (!value?.byteLength) continue;
      // Limit each append even if a fetch implementation returns a large read.
      for (let offset = 0; offset < value.byteLength; offset += 256 * 1024) {
        const part = value.subarray(
          offset,
          Math.min(value.byteLength, offset + 256 * 1024),
        );
        const previousEnd = end();
        let appended = false;
        while (!appended) {
          if (signal.aborted) throw aborted();
          if (mediaSource.readyState !== "open")
            throw new Error("Media buffer closed");
          await prune();
          if (ahead() >= limits.aheadSeconds || aheadBytes >= limits.maxBytes) {
            await wait(signal, limits.pollMs || 200);
            continue;
          }
          try {
            await update(buffer, signal, () =>
              buffer.appendBuffer(part as unknown as BufferSource),
            );
            appended = true;
          } catch (error) {
            if (
              !(error instanceof DOMException) ||
              error.name !== "QuotaExceededError"
            )
              throw error;
            // Retain only this one chunk while playback frees browser capacity.
            await prune();
            await wait(signal, limits.pollMs || 200);
          }
        }
        const bufferedEnd = end();
        if (bufferedEnd > previousEnd) {
          for (const entry of retained)
            if (!Number.isFinite(entry.end)) entry.end = bufferedEnd;
        }
        retained.push({
          end: bufferedEnd > previousEnd ? bufferedEnd : Infinity,
          bytes: part.byteLength,
        });
        aheadBytes += part.byteLength;
      }
    }
  } finally {
    signal.removeEventListener("abort", cancelReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    retained.length = 0;
  }
}
