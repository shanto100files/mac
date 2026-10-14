import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../../src/lib/player/mseBufferPump.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const { pumpMseStream } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeBuffer extends EventTarget {
  updating = false;
  start = 0;
  end = 0;
  appendCalls = 0;
  removals = [];
  activeListeners = new Set();
  quota = false;
  manual = false;
  get buffered() {
    return {
      length: this.end > this.start ? 1 : 0,
      start: () => this.start,
      end: () => this.end,
    };
  }
  addEventListener(name, callback, options) {
    this.activeListeners.add(callback);
    super.addEventListener(name, callback, options);
  }
  removeEventListener(name, callback) {
    this.activeListeners.delete(callback);
    super.removeEventListener(name, callback);
  }
  appendBuffer() {
    assert.equal(this.updating, false, "appends must be sequential");
    this.appendCalls++;
    if (this.quota) throw new DOMException("Full", "QuotaExceededError");
    this.updating = true;
    if (!this.manual)
      queueMicrotask(() => {
        this.end++;
        this.updating = false;
        this.dispatchEvent(new Event("updateend"));
      });
  }
  remove(start, end) {
    assert.equal(this.updating, false);
    this.removals.push([start, end]);
    this.updating = true;
    queueMicrotask(() => {
      this.start = end;
      this.updating = false;
      this.dispatchEvent(new Event("updateend"));
    });
  }
}

function fixture({ samples = 1000000, limits = {}, manual = false } = {}) {
  const controller = new AbortController();
  const buffer = new FakeBuffer();
  buffer.manual = manual;
  const video = { currentTime: 0 };
  const mediaSource = {
    readyState: "open",
    endOfStream() {
      assert.equal(buffer.updating, false);
      this.readyState = "ended";
    },
  };
  const reader = {
    reads: 0,
    cancels: 0,
    released: false,
    async read() {
      return ++this.reads > samples
        ? { done: true }
        : { done: false, value: new Uint8Array(1024) };
    },
    async cancel() {
      this.cancels++;
    },
    releaseLock() {
      this.released = true;
    },
  };
  const result = pumpMseStream({
    reader,
    buffer,
    video,
    mediaSource,
    signal: controller.signal,
    limits: {
      aheadSeconds: 3,
      behindSeconds: 1,
      maxBytes: 1024 * 1024,
      pollMs: 5,
      ...limits,
    },
  });
  const settled = result.then(
    () => null,
    (error) => error,
  );
  return { controller, buffer, video, mediaSource, reader, result, settled };
}

test("a paused fast source stops reading at the ahead limit instead of downloading the movie", async () => {
  const f = fixture();
  await sleep(25);
  assert.equal(f.reader.reads, 3);
  await sleep(25);
  assert.equal(f.reader.reads, 3);
  f.controller.abort();
  assert.equal((await f.settled).name, "AbortError");
  assert.equal(f.reader.released, true);
  assert.equal(f.buffer.activeListeners.size, 0);
});

test("playback resumes reads and removes played data without waiting for browser quota", async () => {
  const f = fixture();
  await sleep(20);
  f.video.currentTime = 3;
  await sleep(25);
  assert.equal(f.reader.reads, 6);
  assert.deepEqual(f.buffer.removals[0], [0, 2]);
  f.controller.abort();
  await f.settled;
});

test("the byte budget stops high-bitrate data even when the time window has spare room", async () => {
  const f = fixture({ limits: { aheadSeconds: 100, maxBytes: 3072 } });
  await sleep(25);
  assert.equal(f.reader.reads, 3);
  f.video.currentTime = 3;
  await sleep(25);
  assert.equal(f.reader.reads, 6);
  f.controller.abort();
  await f.settled;
});

test("EOF waits for the last append and closes MediaSource with no remaining listeners", async () => {
  const f = fixture({ samples: 2 });
  await f.result;
  assert.equal(f.mediaSource.readyState, "ended");
  assert.equal(f.buffer.appendCalls, 2);
  assert.equal(f.reader.released, true);
  assert.equal(f.buffer.activeListeners.size, 0);
});

test("a quota-full paused buffer retains only one chunk and resumes when capacity returns", async () => {
  const f = fixture({ samples: 1 });
  f.buffer.quota = true;
  await sleep(25);
  assert.equal(f.reader.reads, 1);
  assert.equal(f.buffer.activeListeners.size, 0);
  f.buffer.quota = false;
  await f.result;
  assert.equal(f.reader.reads, 2);
  assert.equal(f.reader.released, true);
});

test("leaving during an unfinished append cancels the reader and removes update listeners", async () => {
  const f = fixture({ manual: true });
  await sleep(10);
  assert.equal(f.reader.reads, 1);
  assert.ok(f.buffer.activeListeners.size > 0);
  f.controller.abort();
  assert.equal((await f.settled).name, "AbortError");
  assert.equal(f.buffer.activeListeners.size, 0);
  assert.equal(f.reader.released, true);
  assert.ok(f.reader.cancels > 0);
});

test("leaving while a network read is pending cancels it and releases the stream lock", async () => {
  const controller = new AbortController();
  let cancels = 0;
  const stream = new ReadableStream(
    {
      pull() {},
      cancel() {
        cancels++;
      },
    },
    { highWaterMark: 0 },
  );
  const reader = stream.getReader();
  const buffer = new FakeBuffer();
  const result = pumpMseStream({
    reader,
    buffer,
    video: { currentTime: 0 },
    mediaSource: { readyState: "open" },
    signal: controller.signal,
    limits: { aheadSeconds: 30, behindSeconds: 10, maxBytes: 1024 * 1024 },
  });
  const settled = result.catch((error) => error);
  await sleep(10);
  controller.abort();
  assert.equal((await settled).name, "AbortError");
  assert.equal(cancels, 1);
  assert.equal(stream.locked, false);
  assert.equal(buffer.activeListeners.size, 0);
});
