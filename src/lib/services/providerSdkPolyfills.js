// Runs inside QuickJS. These objects have no connection to browser globals.
import URL from 'core-js-pure/actual/url/index.js';
import URLSearchParams from 'core-js-pure/actual/url-search-params/index.js';
class TextEncoder {
  encode(value = '') {return Uint8Array.from(unescape(encodeURIComponent(String(value))), c => c.charCodeAt(0));}
}
class TextDecoder {
  decode(bytes = []) {
    const array = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    let text = ''; for (const byte of array) text += String.fromCharCode(byte);
    try {return decodeURIComponent(escape(text));} catch {return text;}
  }
}
class Headers {
  constructor(input = []) {
    this.values = new Map();
    if (input?.forEach && !Array.isArray(input)) input.forEach((v, k) => this.append(k, v));
    else for (const [k, v] of Array.isArray(input) ? input : Object.entries(input || {})) this.append(k, v);
  }
  append(k, v) {k = String(k).toLowerCase(); this.values.set(k, this.has(k) ? `${this.get(k)}, ${v}` : String(v));}
  set(k, v) {this.values.set(String(k).toLowerCase(), String(v));}
  get(k) {return this.values.get(String(k).toLowerCase()) ?? null;}
  has(k) {return this.values.has(String(k).toLowerCase());}
  delete(k) {this.values.delete(String(k).toLowerCase());}
  forEach(fn, receiver) {this.values.forEach((v, k) => fn.call(receiver, v, k, this));}
  entries() {return this.values.entries();}
  keys() {return this.values.keys();}
  [Symbol.iterator]() {return this.entries();}
}
class Response {
  constructor(body = '', init = {}) {
    this.status = init.status ?? 200; this.statusText = init.statusText || '';
    this.ok = this.status >= 200 && this.status < 300; this.headers = new Headers(init.headers);
    this.bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : new TextEncoder().encode(String(body ?? ''));
    if (typeof body === 'string' && !this.headers.has('content-type')) this.headers.set('content-type', 'text/plain;charset=UTF-8');
  }
  async text() {return new TextDecoder().decode(this.bytes);}
  async json() {return JSON.parse(await this.text());}
  async arrayBuffer() {return this.bytes.slice().buffer;}
  clone() {return new Response(this.bytes.slice(), this);}
}
class Request {
  constructor(input, init = {}) {this.url = input?.url || String(input); this.method = init.method || input?.method || 'GET'; this.headers = new Headers(init.headers || input?.headers); this.body = init.body;}
}
class AbortController {
  constructor() {this.signal = {aborted:false, addEventListener() {}, removeEventListener() {}, throwIfAborted() {if (this.aborted) throw new Error('Aborted');}};}
  abort() {this.signal.aborted = true;}
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function btoa(value) {
  const bytes = Array.from(String(value), c => {if (c.charCodeAt(0) > 255) throw new Error('Invalid base64 input'); return c.charCodeAt(0);}); let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    result += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  } return result;
}
function atob(value) {
  const text = String(value).replace(/\s/g, '').replace(/=+$/, '');
  if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) throw new Error('Invalid base64 input');
  let bits = 0, count = 0, result = '';
  for (const c of text) {bits = (bits << 6) | alphabet.indexOf(c); count += 6; if (count >= 8) {count -= 8; result += String.fromCharCode((bits >>> count) & 255);}} return result;
}
Object.assign(globalThis, {URL, URLSearchParams, TextEncoder, TextDecoder, Headers, Response, Request, AbortController, btoa, atob, console:{log() {}, info() {}, warn() {}, error() {}, debug() {}}});
