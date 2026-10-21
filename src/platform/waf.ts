import {providerFetch} from '../lib/providers/tauriAxiosAdapter';
import {OpenWebViewOptions, OpenWebViewResult} from '../lib/providers/types';
import {useWafStore} from '../lib/zustand/wafStore';
import {headers as commonHeaders} from '../lib/providers/headers';
import {providerAuthor} from '../lib/providers/providerScope';
import {deleteJarCookie, getJarCookieMap} from '../lib/providers/providerCookieJar';

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
): Promise<OpenWebViewResult> => {
  if (!url) {
    throw new Error('openWebView: a url is required');
  }
  const author = providerAuthor(authorRaw);

  const cacheKey = `${author}|${new URL(url).hostname.toLowerCase()}`;
  const userAgent = pickUserAgent(options?.headers) || commonHeaders['User-Agent'];
  const retryPage = async (solved?: OpenWebViewResult): Promise<OpenWebViewResult> => {
    const retryUserAgent = solved?.userAgent || userAgent;
    const headers = Object.fromEntries(Object.entries(options?.headers || {}).filter(
      ([name]) => !['cookie', 'user-agent'].includes(name.toLowerCase()),
    ));
    headers['User-Agent'] = retryUserAgent;
    const response = await providerFetch(author, url, {headers});
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
  } else if (options?.waitForCookie) {
    // Forced: the saved cookie is bad, drop it before opening
    deleteJarCookie(author, url, options.waitForCookie);
  }

  const promise = new Promise<OpenWebViewResult>((resolve, reject) => {
    useWafStore.getState().enqueue({
      ...options,
      headers: {...options?.headers, 'User-Agent': userAgent},
      url, author, resolve, reject,
    });
  });
  pendingRequests.set(cacheKey, promise);
  const cleanup = () => {
    if (pendingRequests.get(cacheKey) === promise) pendingRequests.delete(cacheKey);
  };
  promise.then(cleanup, cleanup);
  return promise.catch(afterDismissal);
};
