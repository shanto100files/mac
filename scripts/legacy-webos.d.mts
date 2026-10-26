import type {Plugin} from 'vite';
export function legacyWebosPlugin():Plugin;
export function legacyCss(css:string):Promise<string>;
export function legacySandboxWasm(bytes:Uint8Array):Promise<Uint8Array>;
