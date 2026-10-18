import { readFileSync } from "node:fs";

export function windowsBinaryMatches(path, arch) {
  try {
    const bytes = readFileSync(path);
    if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) return false;
    const offset = bytes.readUInt32LE(0x3c);
    if (offset > bytes.length - 6 || bytes.readUInt32LE(offset) !== 0x4550) return false;
    const machine = { x64: 0x8664, arm64: 0xaa64 }[arch];
    return machine !== undefined && bytes.readUInt16LE(offset + 4) === machine;
  } catch {
    return false;
  }
}
