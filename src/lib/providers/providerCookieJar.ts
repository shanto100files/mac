import {providerAuthor} from './providerScope';
import {cookieHeader, cookieMap, decodeCookieJar, putCookies, responseCookies, suppliedCookies, withoutCookie} from './cookieRules';
import type {JarCookie, StoredCookie} from './cookieRules';
export type {JarCookie} from './cookieRules';

// Cookies remain isolated by provider source author; browser profile cookies are
// never used. Legacy records retain their previous root-path/session semantics.
const STORAGE_PREFIX = 'vega_provider_cookies:';
const identityKey = (author: string, url: string) => `vega_verification_identity:${providerAuthor(author)}|${new URL(url).origin}`;
export function storeVerificationUserAgent(author: string, url: string, userAgent: string): void {
  if (!userAgent || userAgent.length > 1000 || /[\r\n\0]/.test(userAgent)) throw new Error('Invalid verification browser identity.');
  localStorage.setItem(identityKey(author, url), userAgent);
}
export function getVerificationUserAgent(author: string, url: string): string | undefined {
  if (!getJarCookieMap(author, url).cf_clearance) return;
  return localStorage.getItem(identityKey(author, url)) || undefined;
}
export function getJarCookies(author: string | undefined): StoredCookie[] {
  try {return decodeCookieJar(JSON.parse(localStorage.getItem(STORAGE_PREFIX + providerAuthor(author)) || 'null'));}
  catch {return [];}
}
function writeJar(author: string | undefined, cookies: StoredCookie[]): void {
  try {
    const key = STORAGE_PREFIX + providerAuthor(author);
    if (cookies.length) localStorage.setItem(key, JSON.stringify({version: 2, cookies}));
    else localStorage.removeItem(key);
  } catch (error) {console.warn('Failed to save provider cookies:', error);}
}
export const getJarCookieMap = (author: string | undefined, url: string): Record<string, string> => cookieMap(getJarCookies(author), url);
export const getJarCookieHeader = (author: string | undefined, url: string): string => cookieHeader(getJarCookies(author), url);

export function buildRequestCookieHeader(author: string | undefined, url: string, supplied?: string): string {
  let jar = getJarCookies(author);
  if (supplied) {jar = suppliedCookies(jar, url, supplied); writeJar(author, jar);}
  const header = cookieHeader(jar, url);
  if (!supplied) return header;
  // An explicitly supplied value takes precedence over same-named path cookies.
  const names = new Set(supplied.split(';').map(pair => pair.slice(0, pair.indexOf('=')).trim()));
  const other = header.split('; ').filter(pair => !names.has(pair.slice(0, pair.indexOf('='))));
  return [supplied, ...other].filter(Boolean).join('; ');
}
export const storeSetCookies = (author: string | undefined, url: string, headers: string[]): void =>
  writeJar(author, responseCookies(getJarCookies(author), url, headers));
export const storeJarCookies = (author: string | undefined, url: string, cookies: JarCookie[]): void =>
  writeJar(author, putCookies(getJarCookies(author), url, cookies));
export const deleteJarCookie = (author: string | undefined, url: string, name: string): void =>
  writeJar(author, withoutCookie(getJarCookies(author), url, name));
