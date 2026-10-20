import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../src/lib/hooks/useMediaSession.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ blockAutoplay = false } = {}) {
  const slots = [];
  let index = 0;
  let effects = [];
  const listeners = new Map();
  const carriers = [];
  const revoked = [];
  const positions = [];
  const session = {
    setActionHandler() {},
    setPositionState: (state) => positions.push(state),
  };
  const react = {
    useRef(value) {
      const slot = index++;
      return slots[slot] ??= { current: value };
    },
    useEffect(callback, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[slot] = { deps, cleanup: callback() };
      });
    },
  };
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => { assert.equal(name, "react"); return react; },
    navigator: { mediaSession: session },
    MediaMetadata: class { constructor(value) { Object.assign(this, value); } },
    Blob,
    URL: {
      createObjectURL: () => "blob:carrier",
      revokeObjectURL: (url) => revoked.push(url),
    },
    Audio: class {
      plays = 0;
      pauses = 0;
      constructor() { carriers.push(this); }
      load() {}
      play() { this.plays++; return blockAutoplay ? Promise.reject(new Error("autoplay")) : Promise.resolve(); }
      pause() { this.pauses++; }
      removeAttribute() {}
    },
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
    },
  });
  const options = {
    enabled: true, title: "Local movie", isPaused: false,
    currentTime: 2, duration: 120, playbackRate: 1,
    onTogglePause() {}, onSeek() {}, onSeekRelative() {},
  };
  return {
    carriers, listeners, revoked, positions, session,
    async render(changes = {}) {
      Object.assign(options, changes);
      index = 0;
      effects = [];
      module.exports.useMediaSession(options);
      effects.forEach((effect) => effect());
      await Promise.resolve();
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

test("built-in video publishes media controls without a second audio pipeline or click retry", async () => {
  const f = fixture({ blockAutoplay: true });
  await f.render();
  await f.render({ isPaused: true });
  await f.render({ isPaused: false, currentTime: 5 });
  assert.equal(f.carriers.length, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.session.metadata.title, "Local movie");
  assert.equal(f.session.playbackState, "playing");
  assert.equal(f.positions.at(-1).position, 5);
  f.unmount();
});

test("native mpv keeps its single carrier across pause/resume and disposes it on exit", async () => {
  const f = fixture();
  await f.render({ needsAudioCarrier: true });
  await f.render({ isPaused: true });
  await f.render({ isPaused: false });
  assert.equal(f.carriers.length, 1);
  assert.equal(f.carriers[0].plays, 2);
  f.unmount();
  assert.deepEqual(f.revoked, ["blob:carrier"]);
  assert.equal(f.listeners.size, 0);
});

test("falling back from mpv removes blocked-autoplay click retries before built-in playback", async () => {
  const f = fixture({ blockAutoplay: true });
  await f.render({ needsAudioCarrier: true });
  assert.equal(f.listeners.size, 2);
  await f.render({ needsAudioCarrier: false });
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.revoked, ["blob:carrier"]);
  assert.equal(f.carriers.length, 1);
  f.unmount();
});

test("inactive native playback does not allocate a carrier", async () => {
  const f = fixture();
  await f.render({ enabled: false, needsAudioCarrier: true });
  assert.equal(f.carriers.length, 0);
  await f.render({ enabled: true });
  assert.equal(f.carriers.length, 1);
  await f.render({ enabled: false });
  assert.deepEqual(f.revoked, ["blob:carrier"]);
  f.unmount();
});
