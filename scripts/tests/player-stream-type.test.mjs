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
  let index = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
    },
    useRef(initial) { return slots[index++] ??= {current: initial}; },
    useCallback: callback => callback,
    useEffect(callback, deps) {
      const slot = index++;
      const previous = slots[slot];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      effects.push(() => {
        previous?.cleanup?.();
        slots[slot] = {deps, cleanup: callback()};
      });
    },
  };
  class FakeVideo {}
  class FakeEngine {
    subscribe() {}
    async load(source, options) { loads.push({source, options}); }
    destroy() {}
  }
  const module = {exports: {}};
  runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "@tauri-apps/api/core") return {};
      if (name === "../player/HtmlVideoEngine") return {HtmlVideoEngine: FakeEngine};
      throw new Error(`Unexpected dependency ${name}`);
    },
    HTMLVideoElement: FakeVideo, navigator: {},
    console: {log() {}, error() {}},
    clearTimeout, setTimeout,
  });
  return {
    loads, video: new FakeVideo(),
    render(video) {
      index = 0;
      effects = [];
      const hook = module.exports.usePlayerEngine(video);
      effects.forEach(effect => effect());
      return hook;
    },
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
