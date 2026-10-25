const MAX_RUNNING = 3;
const MAX_QUEUED = 32;
let running = 0;
const queue: Array<() => void> = [];

async function acquire(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  if (running >= MAX_RUNNING) {
    if (queue.length >= MAX_QUEUED) throw new Error('Too many pending provider operations');
    await new Promise<void>((resolve, reject) => {
      const remove = () => {const index = queue.indexOf(start); if (index !== -1) queue.splice(index,1); signal?.removeEventListener('abort',abort); clearTimeout(timer);};
      const abort = () => {remove(); reject(signal?.reason || new DOMException('Aborted','AbortError'));};
      const start = () => {remove(); resolve();};
      const timer = setTimeout(() => {remove(); reject(new Error('Provider queue timed out'));}, 120_000);
      queue.push(start); signal?.addEventListener('abort',abort,{once:true});
      if (signal?.aborted) abort();
    });
  } else running++;
  return () => {const next = queue.shift(); if (next) next(); else running--;};
}

export async function runWithProviderSlot<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquire(signal);
  try {signal?.throwIfAborted(); return await task();} finally {release();}
}
