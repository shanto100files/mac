import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../src/lib/player/HtmlVideoEngine.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture() {
  let probe = {
    duration: 120, format_name: "mov,mp4",
    video_tracks: [{ index: 0, codec_name: "h264", width: 1920, height: 1080 }],
    audio_tracks: [
      { index: 1, codec_name: "aac", language: "eng", title: "English", is_default: false },
      { index: 3, codec_name: "aac", language: "fra", title: "French", is_default: true },
    ],
    subtitle_tracks: [], chapters: [],
  };
  const module = { exports: {} };
  const mocks = {
    "@tauri-apps/api/core": { invoke: async (name) => name === "probe_media_info" ? probe : undefined },
    "hls.js": { default: { isSupported: () => false } },
    "./jassubManager": { JassubManager: class {} },
    "./deviceProfile": { isLowEndDevice: () => false },
    "./mseCodec": { modernMseMime: () => null },
    "./mseBufferPump": {},
    "../services/torrentStreamService": {
      isTorrentUrl: () => false, getInfoHashFromStreamUrl: () => null,
    },
  };
  runInNewContext(compiled, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(name in mocks, `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    AbortController, setTimeout, clearTimeout,
    console: { info() {}, warn() {}, error() {} },
    window: {}, document: { createElement: () => ({ canPlayType: () => "probably" }) },
  });
  const Engine = module.exports.HtmlVideoEngine;
  // Keep the real load, metadata listener and track-selection behavior. Only
  // replace platform I/O, subtitle rendering and stream transport.
  Engine.prototype.setupSubtitleListener = () => {};
  Engine.prototype.setupStreamInfoListener = () => {};
  Engine.prototype.cleanupMse = () => {};
  Engine.prototype.queueSubtitleRender = async () => {};
  const events = new Map();
  const video = {
    paused: true, duration: 120, videoHeight: 1080, videoWidth: 1920,
    currentTime: 0, playbackRate: 1,
    audioTracks: [{ label: "Decoded audio", language: "", enabled: true }],
    addEventListener: (name, handler) => events.set(name, handler),
    pause() {}, removeAttribute() {}, load() {}, play: async () => {},
  };
  const engine = new Engine(video);
  engine.jassub = null;
  const starts = [];
  engine.startStream = async (time, resume) => starts.push({ time, resume, audio: engine.selectedAudioIndex });
  return { engine, video, starts, metadata: () => events.get("loadedmetadata")(), setProbe: (value) => { probe = value; } };
}

test("local MP4 keeps both container audio tracks when WebKit exposes one", async () => {
  const { engine, metadata } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  assert.equal(engine.playbackMode, "remux");
  metadata();
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.id), [1, 3]);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.selected), [false, true]);
});

test("switching remux audio retains container IDs and selection after metadata reload", async () => {
  const { engine, video, starts, metadata } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  engine.updateState({ currentTime: 42 });
  await engine.selectTrack("aid", 1);
  metadata();
  assert.equal(starts.at(-1).audio, 1);
  assert.equal(starts.at(-1).time, 42);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.id), [1, 3]);
  assert.deepEqual(Array.from(engine.state.audioTracks, (t) => t.selected), [true, false]);
  assert.equal(video.audioTracks[0].enabled, true, "container IDs must not toggle native track indexes");
  const count = starts.length;
  await engine.selectTrack("aid", 1);
  assert.equal(starts.length, count, "selecting the active track must not restart playback");
});

test("a later unprobed source can still discover native audio tracks", async () => {
  const { engine, metadata, setProbe } = fixture();
  await engine.load("/home/user/movie.mp4", { autoPlay: false });
  setProbe(null);
  await engine.load("/home/user/other.mp4", { autoPlay: false });
  metadata();
  assert.equal(engine.state.audioTracks.length, 1);
  assert.equal(engine.state.audioTracks[0].title, "Decoded audio");
});
