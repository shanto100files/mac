// A test-only bridge for app UI suites; real extension suites use Chromium's
// installed content scripts and background worker instead.
export function installTestBrowserExtension() {
  window.vegaPlatformHost = {
    version: 1, kind: 'browser-extension',
    capabilities: {restrictedHeaders:true, isolatedCookies:true, manualRedirects:true, mediaDelivery:true, publicDestinationChecks:true},
    async request(input, signal) {
      const response = await fetch(input.url, {method:input.method, headers:input.headers,
        body:input.body ? new Uint8Array(input.body) : undefined, redirect:input.redirect,
        credentials:'omit', signal});
      return {url:response.url, status:response.status, statusText:response.statusText,
        headers:[...response.headers], body:[...new Uint8Array(await response.arrayBuffer())]};
    },
    prepareMediaSource: async source => source,
    releaseMediaSource: async () => {},
  };
  window.dispatchEvent(new Event('vega-platform-host-change'));
}

export async function connectTestBrowserExtension(page) {
  await page.addInitScript(installTestBrowserExtension);
}
