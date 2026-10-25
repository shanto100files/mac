import {MAX_BODY, exactUrl, requestChanges, redirectHeaders, validateRequest, httpUrl} from './policy.mjs';
import {cookieHeader, decodeCookieJar, responseCookies, suppliedCookies} from './cookieRules.mjs';
import {assertPublicDestination} from './network-guard.mjs';

let queue = Promise.resolve(), active;
const extensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (active && details.initiator === extensionOrigin && details.url === active.url) active.response = details;
}, {urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest']}, ['responseHeaders', 'extraHeaders']);

async function readBounded(response, signal) {
  if (!response.body) return [];
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_BODY) throw new Error('Provider response exceeds the 8 MiB metadata limit.');
      chunks.push(value);
    }
  } catch (error) {await reader.cancel().catch(() => {}); throw error;}
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return Array.from(bytes);
}

export function request(input, signal, delivery = {}) {
  const validated = validateRequest(input);
  const task = queue.then(() => perform({...validated, cookies: delivery.cookies ?? validated.cookies}, signal, delivery.headersOnly === true));
  queue = task.catch(() => {}); return task;
}

async function perform(input, signal, headersOnly) {
  let url = input.url, method = input.method, headers = input.headers, body = input.body;
  let jar = input.cookies ? decodeCookieJar({version: 2, cookies: input.cookies}) : suppliedCookies([], url, new Map(headers).get('cookie') || '');
  const cookieUpdates = [];
  for (let hop = 0; hop <= 10; hop++) {
    signal.throwIfAborted();
    await assertPublicDestination(url, signal);
    let response, captured;
    try {
      await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [1], addRules: [{
        id: 1, priority: 1, condition: {regexFilter: exactUrl(url), isUrlFilterCaseSensitive: true, tabIds: [-1], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest']},
        action: {type: 'modifyHeaders', requestHeaders: requestChanges(headers)},
      }]});
      signal.throwIfAborted(); active = {url};
      // Headers are applied by DNR, outside fetch's forbidden-header guard.
      response = await fetch(url, {method, body: body?.length ? Uint8Array.from(body) : undefined, credentials: 'omit', redirect: 'manual', cache: 'no-store', signal});
      captured = active.response;
      const status = captured?.statusCode || response.status;
      const responseHeaders = captured?.responseHeaders?.filter(item => typeof item.value === 'string').map(item => [item.name, item.value]) || [...response.headers];
      if (status < 200 || status > 599) throw new Error('The browser could not expose this HTTP response.');
      const redirect = [301, 302, 303, 307, 308].includes(status);
      const location = responseHeaders.find(([name]) => name.toLowerCase() === 'location')?.[1];
      const setCookies = responseHeaders.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
      jar = responseCookies(jar, url, setCookies);
      if (!redirect || !location || input.redirect === 'manual') {
        if (headersOnly) await response.body?.cancel();
        return {url, status, headers: responseHeaders, cookieUpdates, body: headersOnly || redirect || method === 'HEAD' ? [] : await readBounded(response, signal)};
      }
      await response.body?.cancel();
      if (input.redirect === 'error') throw new Error('Redirects are disabled for this request.');
      if (setCookies.length) cookieUpdates.push({url, headers: setCookies});
      const next = httpUrl(new URL(location, url).href);
      headers = redirectHeaders(headers, url, next).filter(([name]) => name !== 'cookie');
      const cookie = cookieHeader(jar, next);
      if (cookie) headers.push(['cookie', cookie]);
      if (status === 303 && method !== 'HEAD' || [301, 302].includes(status) && method === 'POST') {
        method = 'GET'; body = undefined; headers = headers.filter(([name]) => !['content-type', 'content-encoding'].includes(name));
      }
      url = next;
    } finally {
      active = undefined;
      await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds: [1]});
    }
  }
  throw new Error('Too many provider redirects.');
}
