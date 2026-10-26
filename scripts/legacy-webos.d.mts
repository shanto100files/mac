import type {Plugin} from 'vite';
export function legacyWebosPlugin(options?:{chrome?:number;lowerSandbox?:boolean}):Plugin;
export function legacyCss(css:string,options?:{chrome?:number}):Promise<string>;
export function lowerLibmediaChunk(code:string,chrome?:number):Promise<string>;
export function legacySandboxWasm(bytes:Uint8Array):Promise<Uint8Array>;
