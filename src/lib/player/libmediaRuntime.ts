/** Check before importing libmedia: its WASM heap initializes during import. */
export function getLibmediaRuntimeError(wasm: typeof WebAssembly | undefined = globalThis.WebAssembly): string | null {
  if (!wasm || typeof wasm.Global !== 'function') {
    return 'Libmedia cannot run on this device: the browser lacks WebAssembly mutable globals (WebAssembly.Global). Playback requires a newer browser runtime; no alternative player will be used.';
  }
  return null;
}
