# Shared application networking

`src/platform/network.ts` is the HTTP entry point for shared app/provider code.
`src/platform/mediaDelivery.ts` prepares sources for the common Libmedia engine.
The player adapter no longer constructs Tauri proxy URLs itself.

## Runtime selection

1. A Tauri runtime uses the existing native Axios/provider implementation and
   Desktop's byte-preserving media proxy. Existing player preferences are unchanged.
2. An installed LG webOS/Amazon Vega wrapper, or a browser extension adapter,
   can register a version-1 `window.vegaPlatformHost` implementing `PlatformHost`
   from `src/platform/host.ts`. Platform identity is explicit, not guessed from UA.
3. Without a host, public HTTP uses ordinary browser fetch with credentials
   omitted. A CORS-permitted server does not require an extension. Requests for
   restricted headers or privileged media sources fail explicitly instead of
   silently losing their headers.

The shared frontend now has an explicit browser build with native startup services
disabled and unsupported native actions hidden. See [browser application](web-app.md)
for commands and current limits. The optional initial [browser extension](../browser-extension/README.md)
implements this contract. Installed TV host projects and build pipelines are
described in [TV apps](tv-apps.md); device/SDK validation limits are listed there.
Registering a host object is not proof of device support. `verifyProvider` is an
optional host method for browser verification; missing implementations fail
explicitly. A shared Block/Ask/Allow permission gate precedes browser and native
verification window creation.

## Host HTTP contract

The host wrapper implements `request(request, signal)` and translates the serializable
request/response objects to its SDK, service bus or extension messaging transport.
Bodies use byte arrays, and headers use tuples so multiple Set-Cookie lines can
be preserved. Never send video bodies through this metadata/request channel.

- Respect `credentials: 'omit'`. Do not attach the system/browser profile's cookies.
- For a provider request, `scope` is its source author. The existing source-scoped
  cookie jar supplies appropriate Cookie headers and consumes returned Set-Cookie
  values. The host must not share authentication between scopes.
- `cookies` optionally supplies that author's typed jar snapshot. A host following
  redirects should reselect matching cookies for each URL and apply intermediate
  Set-Cookie responses. `cookieUpdates: [{url, headers}]` returns those intermediate
  responses so the app persists them against the issuing URL, not the final host.
  The fields extend the v1 contract without requiring older hosts to implement them.
  The extension uses the same generated cookie code as the app; it does not keep a
  second persistent copy of provider cookies in extension storage.
- Declare `isolatedCookies`, `restrictedHeaders` and `manualRedirects` only when the
  implementation supports them. In particular, Amazon's default React Native fetch
  has documented credential/redirect limitations and is not automatically sufficient.
- Provider HTTP, verification and protected media now require
  `publicDestinationChecks: true`. Extension 0.4.0 implements URL/DNS preflight;
  older adapters fail explicitly. Native connection resolution also rejects
  private addresses. See [provider security](provider-security.md) for browser DNS
  pinning limitations and the complete execution/transport boundaries.
- Honor the AbortSignal and cancel backend work where possible. The frontend
  rejects canceled requests even if a host fails to settle its promise.
- Return HTTP status, final URL, headers and original response bytes. HTTP errors
  are responses; transport failures reject. Do not convert an error to status 200.
- Install the host before application requests begin. Tauri's native implementation
  takes precedence over a window bridge.
- An injected extension can set `vegaPlatformHostReady` while its worker authorizes
  the document. Requests wait up to two seconds, with cancellation, before selecting
  the host; an absent extension adds no startup wait.

Raw headers are captured before constructing a browser Request because its header
guard can remove Cookie and Referer. Axios's fetch adapter is explicitly configured
to use platform networking without injecting a default User-Agent or constructing
the guarded Request first. Explicit provider User-Agent values are preserved.

## Optional verification contract

`verifyProvider({url, scope, waitForCookie?, timeoutMs?}, signal)` returns
`{url, userAgent, cookie}`. The shared app checks the Block/Ask/Allow preference
before invoking it or enqueueing a native WAF window. Hosts without this method
reject interactive verification explicitly; ordinary public HTTP still works.

The browser implementation accepts only `cf_clearance` and no provider JavaScript.
It creates a fresh incognito window only when no incognito session is already
open, refuses competing private windows/tabs and binds cookie reads to the created
tab's separate store. It returns no page DOM or profile login cookies. The app
stores the challenge cookie and browser User-Agent by source author/origin, then
retries HTML through source-isolated HTTP. The User-Agent is used only while a live
matching clearance remains in that source's jar; conflicting Sec-* hints are
removed. Verification cancellation closes its owned window. See the extension
README for setup, limits and test scope. Native Tauri uses its existing private
WebView, with per-request labels and cancellation, behind the same consent gate.

## Host media contract

Implement `prepareMediaSource` and advertise `mediaDelivery` only when the host can
prepare the whole media chain. Return a source consumable by Libmedia, keeping
the descriptor's metadata/resume position and clearing headers already handled
by the host. Source URL rewriting must also handle HLS children, segments, keys,
subtitles, redirects and byte ranges with appropriate credential scope.

Networking capability alone does not make protected media playable: Libmedia
performs its own requests. The delivery implementation needs a suitable URL or
transport for those requests. Future wrappers must implement source replacement,
cleanup and lifecycle behavior rather than relying on a permanent proxy implicitly.
Hosts can implement `releaseMediaSource(id)` to revoke leases and prepared URLs.
The app retains the original host owner and releases sources on replacement,
failure, superseded preparation and player destruction. Subtitles use bounded
host HTTP directly, with local files still going through native preparation.

For Desktop, preparation retains `/source`, `/playlist.m3u8`, `/file` and
`/local/<token>/media` on the existing loopback server. This path does not request
FFmpeg remuxing/transcoding. Subtitle loading also uses platform preparation.

## Checks

```powershell
npm run test:platform
npm run test:libmedia
npm run test:libmedia:browser
npm run test:web
npm run build
```

The browser suite verifies raw restricted headers across fetch/provider/Axios
paths, direct public Axios requests, empty installed-provider/source lists,
explicit source/provider installation, the provider-to-player flow, app startup,
and actual shared-player rendering, subtitles, seeking and cleanup. Host SDK calls
are mocked; these checks do not establish webOS, Amazon Vega or Tauri WebView
compatibility. Hardware/platform packaging is tracked in the workspace root plan.
