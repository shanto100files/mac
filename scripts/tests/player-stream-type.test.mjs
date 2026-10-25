import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {test} from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../../src/lib/hooks/usePlayerEngine.ts", import.meta.url), "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

function fixture() {
  const slots = [];
  const loads = [];
  const engines = {created: 0, destroyed: 0};
  let index = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
    },
    useRef(initial) { return slots[index++] ??= {current: initial}; },
    useCallback(callback, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return previous.callback;
      slots[slot] = {deps, callback};
      return callback;
    },
    useEffect(callback, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      effects.push({slot, previous, deps, callback});
    },
  };
  class FakeVideo {}
  class FakeEngine {
    constructor() { engines.created++; }
    subscribe() {}
    async load(source, options) { loads.push({source, options}); }
    destroy() { engines.destroyed++; }
  }
  const module = {exports: {}};
  runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "@tauri-apps/api/core") return {};
      if (name === "../player/HtmlVideoEngine") return {HtmlVideoEngine: FakeEngine};
      if (name === "../player/LibmediaPlayerAdapter") return {LibmediaPlayerAdapter: FakeEngine};
      if (name === "../../platform/host") return {isTauriRuntime: () => false};
      throw new Error(`Unexpected dependency ${name}`);
    },
    HTMLVideoElement: FakeVideo, navigator: {},
    console: {log() {}, error() {}},
    clearTimeout, setTimeout,
  });
  return {
    loads, engines, video: new FakeVideo(),
    render(video, commit, engineKind = "builtin") {
      index = 0;
      effects = [];
      const hook = module.exports.usePlayerEngine(video, undefined, engineKind);
      commit?.(hook);
      effects.forEach(effect => effect.previous?.cleanup?.());
      effects.forEach(({slot, deps, callback}) => { slots[slot] = {deps, cleanup: callback()}; });
      return hook;
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test("loadFile forwards the provider stream type and headers to a mounted engine", async () => {
  const f = fixture();
  const player = f.render(f.video);
  const headers = {Referer: "https://provider.test/"};
  await player.loadFile("https://worker.test/playlist/token", headers, [], "m3u8");
  assert.equal(f.loads.length, 1);
  assert.equal(f.loads[0].options.streamType, "m3u8");
  assert.equal(f.loads[0].options.headers, headers);
});

test("committing a video ref does not destroy the engine when its bound-node state resolves", async () => {
  const f = fixture();
  const ref = {current: null};
  const player = f.render(ref, hook => hook.bindVideo(f.video));
  await player.loadFile("/media/movie.mkv");
  f.render(ref);
  assert.equal(f.engines.created, 1);
  assert.equal(f.engines.destroyed, 0, "ref resolution must not cancel the active stream");
  assert.equal(f.loads.length, 1);
  f.unmount();
  assert.equal(f.engines.destroyed, 1);
});

test("replacing the video node or switching engine still disposes the previous engine", () => {
  const f = fixture();
  const ref = {current: null};
  let player = f.render(ref, hook => hook.bindVideo(f.video));
  player.bindVideo(new f.video.constructor());
  player = f.render(ref);
  assert.deepEqual(f.engines, {created: 2, destroyed: 1});
  f.render(ref, undefined, "libmedia");
  assert.deepEqual(f.engines, {created: 3, destroyed: 2});
  f.unmount();
  assert.equal(f.engines.destroyed, 3);
});

test("a stream queued before the video mounts retains the provider stream type", async () => {
  const f = fixture();
  const player = f.render();
  await player.loadFile("https://worker.test/playlist/token", {}, [], "hls");
  assert.equal(f.loads.length, 0);
  player.bindVideo(f.video);
  f.render();
  await Promise.resolve();
  assert.equal(f.loads.length, 1);
  assert.equal(f.loads[0].options.streamType, "hls");
});
