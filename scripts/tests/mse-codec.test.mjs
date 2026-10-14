import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../../src/lib/player/mseCodec.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext}}).outputText;
const {modernMseMime} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("the reported 4K VP9 Profile 2 file declares VP9 10-bit plus converted AAC audio", () => {
  assert.equal(modernMseMime("vp9", true, "Profile 2", 10), 'video/mp4; codecs="vp09.02.51.10, mp4a.40.2"');
});

test("ordinary 8-bit VP9 and silent tracks keep the correct video declaration", () => {
  assert.equal(modernMseMime("vp9", false, "Profile 0", 8), 'video/mp4; codecs="vp09.00.51.08"');
});

test("profile metadata still identifies 10-bit VP9 when bit depth is absent", () => {
  assert.equal(modernMseMime("vp9", true, "Profile 2"), 'video/mp4; codecs="vp09.02.51.10, mp4a.40.2"');
});

test("AV1 is declared as AV1 with the probed bit depth instead of AVC", () => {
  assert.equal(modernMseMime("av1", true, "Main", 10), 'video/mp4; codecs="av01.0.08M.10, mp4a.40.2"');
});

test("H.264, HEVC and unknown codecs leave their existing handling in charge", () => {
  for (const codec of ["h264", "hevc", "auto"]) assert.equal(modernMseMime(codec, true), undefined);
});
