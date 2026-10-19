import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";

// Run the real player callback with a window-manager double. The rest of the
// player requires a Tauri webview, media playback and provider/router state.
const filename = new URL("../../src/pages/PlayerPage.tsx", import.meta.url);
const source = ts.createSourceFile("PlayerPage.tsx", readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "toggleFullscreen") {
    callback = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, "Player fullscreen callback must exist");
const compiled = ts.transpileModule(`globalThis.toggle = ${callback};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture(nativeFullscreen = false) {
  const calls = [];
  const ref = { current: false };
  const win = new Proxy({
    // Deliberately remain false after the request, as with asynchronous GTK.
    isFullscreen: async () => nativeFullscreen,
    setFullscreen: async (value) => { calls.push(["fullscreen", value]); },
    setDecorations: async (value) => { calls.push(["decorations", value]); },
  }, {
    get(target, key) {
      if (!(key in target)) assert.fail(`Linux must not require window API: ${String(key)}`);
      return target[key];
    },
  });
  const context = {
    getCurrentWindow: () => win, isWindows: false, isFullscreenRef: ref,
    setIsFullscreen: (value) => { calls.push(["state", value]); },
    console,
  };
  runInNewContext(compiled, context);
  return { calls, ref, toggle: context.toggle };
}

test("Linux fullscreen does not fall back to borderless resizing before GTK confirms", async () => {
  const { toggle, calls, ref } = fixture();
  await toggle();
  assert.deepEqual(calls, [["fullscreen", true], ["state", true]]);
  assert.equal(ref.current, true);
});

test("Linux can exit even before its window manager reports the entry", async () => {
  const { toggle, calls, ref } = fixture();
  await toggle();
  calls.length = 0;
  await toggle();
  assert.deepEqual(calls, [["fullscreen", false], ["decorations", true], ["state", false]]);
  assert.equal(ref.current, false);
});

test("Linux can exit fullscreen entered outside the player", async () => {
  const { toggle, calls } = fixture(true);
  await toggle();
  assert.deepEqual(calls, [["fullscreen", false], ["decorations", true], ["state", false]]);
});
