import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.route('**/platform-test', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Platform transport regression</title>'}));
  await page.goto('/platform-test');
});

test('actual browser preserves restricted headers for host fetch, provider fetch and Axios', async ({page}) => {
  const result = await page.evaluate(async () => {
    const requests = [];
    window.vegaPlatformHost = {
      version: 1, kind: 'amazon-vega',
      capabilities: {restrictedHeaders: true, isolatedCookies: true, publicDestinationChecks:true, manualRedirects: true, mediaDelivery: false},
      request: async request => {
        requests.push(request);
        return {url: request.url, status: 200, headers: [['Content-Type', 'application/json'], ['Set-Cookie', 'server=owned; Path=/']], body: [...new TextEncoder().encode('{"ok":true}')]};
      },
    };
    const {platformFetch, platformAxiosAdapter, providerFetch} = await import('/src/platform/network.ts');
    const {default: axios} = await import('/node_modules/.vite/deps/axios.js');
    await platformFetch('https://provider.example/one', {headers: {Cookie: 'manual=one', Referer: 'https://source.example/'}});
    const provider = await providerFetch('source-a', 'https://provider.example/two', {headers: {Cookie: 'manual=two', Referer: 'https://source.example/'}});
    await axios.get('https://provider.example/three', {adapter: platformAxiosAdapter, headers: {Cookie: 'manual=three', Referer: 'https://source.example/'}});
    const {extensionStorage} = await import('/src/lib/storage/extensionStorage.ts');
    return {requests, cookies: provider.headers.get('x-set-cookie'), installed: extensionStorage.getInstalledProviders(), sources: extensionStorage.getProviderSources()};
  });
  expect(result.requests).toHaveLength(3);
  for (const [index, request] of result.requests.entries()) {
    const headers = new Map(request.headers);
    expect(headers.get('cookie')).toBe(`manual=${['one', 'two', 'three'][index]}`);
    expect(headers.get('referer')).toBe('https://source.example/');
    expect(request.credentials).toBe('omit');
  }
  expect(result.requests[1].scope).toBe('source-a');
  expect(result.cookies).toBe('server=owned; Path=/');
  expect(result.installed).toEqual([]); expect(result.sources).toEqual([]);
});

test('actual browser reports restricted-header access without a host instead of dropping it', async ({page}) => {
  const code = await page.evaluate(async () => {
    const {platformFetch} = await import('/src/platform/network.ts');
    try {await platformFetch('https://provider.example/', {headers: {Cookie: 'must-not-disappear=1'}});}
    catch (error) {return error.code;}
  });
  expect(code).toBe('HOST_REQUIRED');
});

test('public Axios requests work in the actual browser without any platform host', async ({page}) => {
  await page.route('https://public.example/data', route => route.fulfill({
    contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: '{"public":true}',
  }));
  const data = await page.evaluate(async () => {
    const {platformAxiosAdapter} = await import('/src/platform/network.ts');
    const {default: axios} = await import('/node_modules/.vite/deps/axios.js');
    return (await axios.get('https://public.example/data', {adapter: platformAxiosAdapter})).data;
  });
  expect(data).toEqual({public: true});
});

test('browser verification fails explicitly without opening a native WAF dialog', async ({page}) => {
  const result = await page.evaluate(async () => {
    const {openWebView} = await import('/src/platform/waf.ts');
    const {useWafStore} = await import('/src/lib/zustand/wafStore.ts');
    try {await openWebView('https://provider.example/', undefined, 'source-a');}
    catch (error) {return {message: error.message, pending: useWafStore.getState().requests.length};}
  });
  expect(result).toEqual({message: 'Interactive provider verification is not supported by this platform host yet.', pending: 0});
});
