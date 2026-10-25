import {providerFetch} from './network';
import {getPlatformHost, isTauriRuntime, requirePublicDestinationChecks} from './host';
import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';
import {useWafStore} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import {providerAuthor} from '../lib/providers/providerScope';
import {deleteJarCookie, getJarCookieMap, getVerificationUserAgent, storeJarCookies, storeVerificationUserAgent} from '../lib/providers/providerCookieJar';
import {authorizeVerification} from '../lib/zustand/verificationConsentStore';
import {extensionStorage} from '../lib/storage/extensionStorage';

const pickUserAgent = (
  h?: Record<string, string>,
): string | undefined => {
  if (!h) return undefined;
  const key = Object.keys(h).find(k => k.toLowerCase() === 'user-agent');
  return key ? h[key] : undefined;
};

const pendingRequests = new Map<string, Promise<OpenWebViewResult>>();

/**
 * Opens the WAF solver for a provider. Cookies are read from and saved to the
 * jar of `author` (the provider's source author), never another author's.
 */
export const openWebView = async (
  url: string,
  options: OpenWebViewOptions | undefined,
  authorRaw: string,
  providerValue?: string,
  signal?: AbortSignal,
): Promise<OpenWebViewResult> => {
  if (!url) {
    throw new Error('openWebView: a url is required');
  }
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Verification requires an HTTP(S) URL without credentials.');
  signal?.throwIfAborted();
  const native = isTauriRuntime();
  const host = native ? undefined : getPlatformHost();
  if (!native && !host?.verifyProvider) {
    throw new Error('Interactive provider verification is not supported by this platform host yet.');
  }
  const author = providerAuthor(authorRaw);
  if (host) requirePublicDestinationChecks(host);

  if (!native && (options?.injectedJavaScript || options?.waitForCookie && options.waitForCookie !== 'cf_clearance')) throw new Error('Browser verification supports only cf_clearance and does not run provider JavaScript.');
  const cacheKey = `${author}|${providerValue || ''}|${parsed.origin}`;
  const userAgent = pickUserAgent(options?.headers) || commonHeaders['User-Agent'];
  const retryPage = async (solved?: OpenWebViewResult): Promise<OpenWebViewResult> => {
    const retryUserAgent = solved?.userAgent || (!native && getVerificationUserAgent(author, url)) || userAgent;
    const headers = Object.fromEntries(Object.entries(options?.headers || {}).filter(
      ([name]) => !['cookie', 'user-agent'].includes(name.toLowerCase()),
    ));
    headers['User-Agent'] = retryUserAgent;
    if (!native) for (const name of Object.keys(headers)) if (/^sec-/i.test(name)) delete headers[name];
    const response = await providerFetch(author, url, {headers, signal});
    if (!response.ok) throw new Error(`WAF retry failed: HTTP ${response.status}`);
    const data = await response.text();
    const cookieMap = getJarCookieMap(author, response.url || url);
    const cookies = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
    return {data, cookies, cookie: cookies, cookieMap, url: response.url || url, userAgent: retryUserAgent};
  };
  const afterDismissal = async (error: unknown): Promise<OpenWebViewResult> => {
    if (!(error instanceof Error) || error.message !== 'WAF_DIALOG_CANCELLED') throw error;
    // Dismissal permits one silent HTTP retry, never another dialog.
    try {
      return await retryPage();
    } catch {
      throw error;
    }
  };
  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending.then(retryPage, afterDismissal);

  // Handle force and fast path
  if (!options?.force && options?.waitForCookie) {
    const cookieMap = getJarCookieMap(author, url);
    if (cookieMap[options.waitForCookie]) {
      if (!native) return retryPage();
      // Fast path: we already have the awaited cookie, return it immediately
      const existingCookies = Object.entries(cookieMap)
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');

      return {
        data: '',
        cookies: existingCookies,
        cookie: existingCookies,
        cookieMap,
        url,
        userAgent: pickUserAgent(options?.headers) || commonHeaders['User-Agent'],
      };
    }
  }

  const promise = (async () => {
    const installed = extensionStorage.getInstalledProviders().find(provider => provider.value === providerValue && providerAuthor(provider.source?.author) === author);
    await authorizeVerification(installed?.display_name || providerValue || author, url, signal);
    signal?.throwIfAborted();
    if (options?.force && options.waitForCookie) deleteJarCookie(author, url, options.waitForCookie);
    if (!native) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', abort, {once:true});
      try {
        if (signal?.aborted) abort();
        const result = await host!.verifyProvider!({url, scope: author, waitForCookie: options?.waitForCookie, timeoutMs: options?.timeoutMs}, controller.signal);
        controller.signal.throwIfAborted();
        if (new URL(result.url).origin !== parsed.origin || result.cookie?.name !== 'cf_clearance' || typeof result.cookie.value !== 'string' || !result.cookie.value || typeof result.userAgent !== 'string') throw new Error('Invalid browser verification result.');
        storeJarCookies(author, result.url, [result.cookie]);
        storeVerificationUserAgent(author, result.url, result.userAgent);
        // Read HTML through isolated provider HTTP, never from a logged-in DOM.
        return retryPage({data:'', cookies:'', cookieMap:{}, userAgent:result.userAgent, url:result.url});
      } finally {signal?.removeEventListener('abort', abort);}
    }
    return new Promise<OpenWebViewResult>((resolve, reject) => {
      const finish = (result: OpenWebViewResult) => {signal?.removeEventListener('abort', abort); resolve(result);};
      const fail = (error: Error) => {signal?.removeEventListener('abort', abort); reject(error);};
      const id = useWafStore.getState().enqueue({...options, headers:{...options?.headers,'User-Agent':userAgent}, url, author, signal, resolve:finish, reject:fail});
      const abort = () => {useWafStore.getState().remove(id); fail(signal?.reason || new DOMException('Aborted','AbortError'));};
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort();
    });
  })();
  pendingRequests.set(cacheKey, promise);
  const cleanup = () => {
    if (pendingRequests.get(cacheKey) === promise) pendingRequests.delete(cacheKey);
  };
  promise.then(cleanup, cleanup);
  return promise.catch(afterDismissal);
};
