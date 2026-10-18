import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowsBinaryMatches } from '../windows-binary.mjs';

test('rejects a DLL from the wrong architecture and malformed PE files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'vega-pe-'));
  try {
    const path = join(directory, 'sample.dll');
    const bytes = Buffer.alloc(256);
    bytes.writeUInt16LE(0x5a4d, 0);
    bytes.writeUInt32LE(128, 0x3c);
    bytes.writeUInt32LE(0x4550, 128);
    for (const [arch, machine, other] of [['arm64', 0xaa64, 'x64'], ['x64', 0x8664, 'arm64']]) {
      bytes.writeUInt16LE(machine, 132);
      writeFileSync(path, bytes);
      assert.equal(windowsBinaryMatches(path, arch), true);
      assert.equal(windowsBinaryMatches(path, other), false);
    }
    bytes.writeUInt32LE(0xffffffff, 0x3c);
    writeFileSync(path, bytes);
    assert.equal(windowsBinaryMatches(path, 'arm64'), false);
    writeFileSync(path, 'not a PE binary');
    assert.equal(windowsBinaryMatches(path, 'x64'), false);
    assert.equal(windowsBinaryMatches(join(directory, 'missing'), 'x64'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
