import { windowsBinaryMatches } from './windows-binary.mjs';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Run this check on Windows.');
const files = [
  ['src-tauri/lib/libmpv-2.dll', process.arch],
  ['src-tauri/lib/libmpv-wrapper.dll', process.arch],
  ['src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe', process.arch],
  ['src-tauri/resources/ffmpeg-sidecar/ffprobe.exe', process.arch],
  ['src-tauri/resources/warp/usque.exe', process.arch],
  // ByeDPI has no upstream Windows ARM64 build and is an external process.
  ['src-tauri/resources/byedpi/ciadpi.exe', 'x64'],
];
for (const [relative, arch] of files) {
  const path = fileURLToPath(new URL(`../${relative}`, import.meta.url));
  if (!windowsBinaryMatches(path, arch)) {
    throw new Error(`Missing or incorrect ${arch} Windows binary: ${relative}`);
  }
  console.log(`Verified ${arch}: ${relative}`);
}
