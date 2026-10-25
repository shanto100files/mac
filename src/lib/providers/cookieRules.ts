import {getDomain} from 'tldts';

export interface JarCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  hostOnly?: boolean;
  expiresAt?: number | null;
}
export interface StoredCookie extends JarCookie {
  domain: string;
  path: string;
  secure: boolean;
  hostOnly: boolean;
  expiresAt: number | null;
  createdAt: number;
}
const LIMIT = 500;
const validPair = (name: unknown, value: unknown): name is string =>
  typeof name === 'string' && /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) &&
  typeof value === 'string' && !/[\x00-\x20\x7f;]/.test(value) && name.length + value.length <= 16_384;
const domainMatches = (host: string, domain: string, hostOnly: boolean) =>
  host === domain || (!hostOnly && !/^[\d.]+$/.test(host) && !host.includes(':') && host.endsWith(`.${domain}`));
const pathMatches = (path: string, cookiePath: string) =>
  path === cookiePath || (path.startsWith(cookiePath) && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'));
const defaultPath = (url: URL) => url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
const alive = (cookie: StoredCookie, now: number) => cookie.expiresAt === null || cookie.expiresAt > now;
const urlOf = (input: string) => {try {const url = new URL(input); return /^https?:$/.test(url.protocol) ? url : undefined;} catch {return undefined;}};
const registrable = (domain: string) => getDomain(domain, {allowPrivateDomains: true}) !== null;

/** Decode the current format, or retain legacy domain/name entries as root cookies. */
export function decodeCookieJar(value: unknown, now = Date.now()): StoredCookie[] {
  if (!value || typeof value !== 'object') return [];
  const object = value as Record<string, unknown>;
  const candidates: unknown[] = object.version === 2 && Array.isArray(object.cookies) ? object.cookies : [];
  if (object.version === undefined) {
    for (const [domain, names] of Object.entries(object)) {
      if (!names || typeof names !== 'object' || Array.isArray(names)) continue;
      for (const [name, cookie] of Object.entries(names)) if (cookie && typeof cookie === 'object') {
        candidates.push({...cookie, domain, name, path: '/', secure: false, createdAt: 0});
      }
    }
  }
  const result: StoredCookie[] = [];
  for (const entry of candidates) {
    if (!entry || typeof entry !== 'object') continue;
    const cookie = entry as StoredCookie;
    if (!validPair(cookie.name, cookie.value) || typeof cookie.domain !== 'string' || typeof cookie.path !== 'string' || !cookie.path.startsWith('/') ||
        typeof cookie.hostOnly !== 'boolean' || typeof cookie.secure !== 'boolean' ||
        !(cookie.expiresAt === null || typeof cookie.expiresAt === 'number' && Number.isFinite(cookie.expiresAt))) continue;
    const domain = cookie.domain.toLowerCase();
    const host = urlOf(`https://${domain}/`);
    if (!host || host.hostname !== domain || !cookie.hostOnly && !registrable(domain)) continue;
    if (alive(cookie, now)) result.push({...cookie, domain, createdAt: Number.isFinite(cookie.createdAt) ? cookie.createdAt : 0});
  }
  return result.slice(-LIMIT);
}

export function putCookies(jar: StoredCookie[], input: string, cookies: JarCookie[], now = Date.now()): StoredCookie[] {
  const url = urlOf(input); if (!url) return jar;
  let result = jar.filter(cookie => alive(cookie, now));
  for (const cookie of cookies) {
    if (!validPair(cookie.name, cookie.value)) continue;
    const attrDomain = cookie.domain?.trim().toLowerCase().replace(/^\./, '');
    if (attrDomain && !domainMatches(url.hostname, attrDomain, false)) continue;
    let hostOnly = cookie.hostOnly ?? !attrDomain;
    const domain = attrDomain || url.hostname;
    if (!hostOnly && !registrable(domain)) {
      if (domain !== url.hostname) continue;
      hostOnly = true;
    }
    const path = cookie.path?.startsWith('/') ? cookie.path : defaultPath(url);
    const secure = cookie.secure === true;
    if (secure && url.protocol !== 'https:') continue;
    if (cookie.name.startsWith('__Secure-') && !secure) continue;
    if (cookie.name.startsWith('__Host-') && (!secure || !hostOnly || path !== '/' || attrDomain)) continue;
    // An insecure response cannot overwrite/delete a matching Secure cookie.
    if (url.protocol !== 'https:' && result.some(previous => previous.name === cookie.name && previous.secure &&
        (domainMatches(domain, previous.domain, false) || domainMatches(previous.domain, domain, false)) && pathMatches(path, previous.path))) continue;
    const previous = result.find(item => item.name === cookie.name && item.domain === domain && item.path === path);
    result = result.filter(item => item !== previous);
    const expiresAt = cookie.expiresAt ?? null;
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) continue;
    result.push({name: cookie.name, value: cookie.value, domain, path, secure, hostOnly, expiresAt, createdAt: previous?.createdAt ?? now});
  }
  return result.slice(-LIMIT);
}

function parseSetCookie(header: string, now: number): JarCookie | undefined {
  const [pair, ...attributes] = header.split(';'), eq = pair.indexOf('=');
  if (eq <= 0) return;
  const cookie: JarCookie = {name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim()};
  let maxAge: number | undefined;
  for (const attribute of attributes) {
    const separator = attribute.indexOf('='), key = (separator < 0 ? attribute : attribute.slice(0, separator)).trim().toLowerCase();
    const value = separator < 0 ? '' : attribute.slice(separator + 1).trim();
    if (key === 'domain') cookie.domain = value;
    else if (key === 'path') cookie.path = value;
    else if (key === 'secure') cookie.secure = true;
    else if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
    else if (key === 'expires') {const expiry = Date.parse(value); if (Number.isFinite(expiry)) cookie.expiresAt = expiry;}
  }
  if (maxAge !== undefined) cookie.expiresAt = maxAge <= 0 ? 0 : Math.min(Number.MAX_SAFE_INTEGER, now + maxAge * 1000);
  return cookie;
}

export function responseCookies(jar: StoredCookie[], url: string, headers: string[], now = Date.now()): StoredCookie[] {
  const cookies = headers.flatMap(header => header.split(/,(?=\s*[^;,\s]+=)/).map(part => parseSetCookie(part.trim(), now)).filter((cookie): cookie is JarCookie => !!cookie));
  return putCookies(jar, url, cookies, now);
}

export function matchingCookies(jar: StoredCookie[], input: string, now = Date.now()): StoredCookie[] {
  const url = urlOf(input); if (!url) return [];
  return jar.filter(cookie => alive(cookie, now) && domainMatches(url.hostname, cookie.domain, cookie.hostOnly) &&
    pathMatches(url.pathname || '/', cookie.path) && (!cookie.secure || url.protocol === 'https:'))
    .sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
}
export function cookieHeader(jar: StoredCookie[], url: string): string {
  return matchingCookies(jar, url).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}
export function cookieMap(jar: StoredCookie[], url: string): Record<string, string> {
  const values = new Map<string, string>();
  for (const cookie of matchingCookies(jar, url)) if (!values.has(cookie.name)) values.set(cookie.name, cookie.value);
  return Object.fromEntries(values);
}
/** Explicit provider headers become host-only root cookies, with Secure on HTTPS. */
export function suppliedCookies(jar: StoredCookie[], url: string, header: string): StoredCookie[] {
  const secure = urlOf(url)?.protocol === 'https:';
  const cookies = header.split(';').flatMap(pair => {
    const eq = pair.indexOf('=');
    return eq <= 0 ? [] : [{name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), path: '/', secure}];
  });
  return putCookies(jar, url, cookies);
}
export function withoutCookie(jar: StoredCookie[], url: string, name: string): StoredCookie[] {
  const visible = new Set(matchingCookies(jar, url));
  return jar.filter(cookie => cookie.name !== name || !visible.has(cookie));
}
