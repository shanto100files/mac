import assert from "node:assert/strict";
import test from "node:test";
import { systemMediaDependencies } from "../linux-media-dependencies.mjs";

const needed = (name) => ` 0x0000000000000001 (NEEDED) Shared library: [${name}]`;

test("accepts bundled media tools that only link to host runtime libraries", () => {
  assert.deepEqual(systemMediaDependencies([
    "libm.so.6", "libdl.so.2", "librt.so.1", "libpthread.so.0", "libc.so.6",
    "ld-linux-x86-64.so.2", "libgcc_s.so.1", "libmvec.so.1",
  ].map(needed).join("\n")), []);
  assert.deepEqual(systemMediaDependencies("There is no dynamic section in this file."), []);
});

test("rejects system FFmpeg and VA-API dependencies responsible for ABI conflicts", () => {
  const libraries = ["libavutil.so.61", "libavcodec.so.63", "libavformat.so.63", "libva.so.2", "libva-drm.so.2"];
  assert.deepEqual(systemMediaDependencies([...libraries, "libc.so.6"].map(needed).join("\n")), libraries);
});
