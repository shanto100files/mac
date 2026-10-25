# Installed LG webOS and Amazon Vega apps

The TV builds reuse the shared React UI, QuickJS provider sandbox, source-scoped
cookie jar, auto-update preference and common Libmedia player. They do not use a
Chrome extension, MPV or an FFmpeg player. Installations start with no provider
sources and no providers; users add and install their own explicitly.

Both wrappers serve the packaged UI from a loopback host. HTTP is performed by
the app's service/native module, outside the WebView's CORS/header restrictions.
The WebView's security remains enabled. A packaged app alone does not bypass CORS.

## Build commands

From `vega-desktop`, install frontend dependencies (`npm ci --ignore-scripts` is
sufficient for TV-only builds; it skips Desktop binary downloads).

```sh
npm run build:webos
npm run build:amazon-vega
npm run test:tv
cargo test --locked --manifest-path tv/native-host/Cargo.toml
npm run test:tv:browser
```

`build:*` builds the actual production UI and stages the corresponding native
project in `dist-tv/<platform>`. It does not claim an installable Amazon package.
The browser check also needs Rust and Playwright Chromium (`npx playwright install chromium`).

### LG webOS

```sh
npm install --global @webos-tools/cli@3.2.6
npm run package:webos
ares-install --device YOUR_TV dist-tv/webos/in.vegaapp.tv_2.3.0_all.ipk
ares-launch --device YOUR_TV in.vegaapp.tv
```

Configure your TV in LG's CLI and enable its Developer Mode before installing.
The `.ipk` contains the launch app, Node service, bundled destination policy and
all UI/player JavaScript assets. It does not depend on a running development PC.
The launch app authenticates through Luna to `in.vegaapp.tv.network/start`.
Only the app's Luna sender ID may receive the session URL. The service holds an
Activity Manager activity while the foreground app sends heartbeats; it closes
after 90 seconds without activity. Resume after service eviction currently
requires reopening the app.

Initial compatibility target is **webOS TV 25+**, whose Chromium 120+ engine
matches the shared frontend's modern CSS requirements. The service requires
Node 16+. Older TVs need a separate compatibility pass, not just a changed label.
`requiredACG` declares `activity.operation` for Activity Manager calls on webOS
versions that enforce ACG. Luna registration, background/resume and hardware
decoding must still be verified on a real TV; Chrome tests do not cover these.

### Amazon Vega OS

Use a supported Linux/macOS machine with the Amazon Vega SDK and authenticated
Amazon npm registry. Install Rust targets used by the SDK, for example:

```sh
rustup target add armv7-unknown-linux-gnueabihf aarch64-unknown-linux-gnu x86_64-unknown-linux-gnu
npm run package:amazon-vega
```

The script generates Amazon's `vegaWebview` app and `basic-turbo-module` projects
using the installed SDK. It installs the `VegaTransport` TypeScript interface,
runs SDK codegen, connects its generated C++ methods to the Rust host's C ABI,
and builds using the template's `npm run build:app`. The CMake module compiles
Rust with the SDK compiler/sysroot and statically links it; it does not ship a
Desktop executable or require a separate server on another machine.

Packages are emitted under `dist-tv/amazon-vega/app/build/**/*.vpkg`. The SDK owns
its React Native/WebView package versions and ABI checks. A codegen signature
change fails packaging with an explicit error instead of shipping stub methods.
The app enables cleartext **only for 127.0.0.1** for its internal server, declares
OS 1.2, and confines WebView navigation to the packaged app's session path.
The Rust host listens on port 32178; LG uses 32177. Stable ports preserve the
UI's origin/local storage across launches; session tokens change each launch.

**Amazon SDK generation, C++ codegen/linking, VPKG packaging and device playback
have not been run in this Windows workspace.** The Rust transport itself is
compiled/tested locally and serves the actual Amazon UI in Chrome. The first SDK
runner build is an integration checkpoint, not a claim of certified device support.

## CI pipeline

`.github/workflows/tv.yml` runs transport tests, Rust checks and both packaged UI
browser checks on Linux. LG packaging runs on a hosted Linux runner and uploads
the `.ipk` artifact. The optional Amazon job needs a pre-provisioned, trusted
runner labeled `self-hosted`, `linux`, `vega-sdk` with SDK commands available in
PATH and the SDK's registry/toolchain configured for the runner account.

Run **TV apps** from GitHub Actions; enable the Amazon input when that runner is
available. A `tv-v*` tag requests both packages. Jobs upload build artifacts;
they do not publish to either app store. No signing keys or registry credentials
are embedded in the app projects.

## Native host boundaries and playback

- App assets and API calls need a random 256-bit session token. API requests also
  require a same-origin JSON POST and custom session header. The service binds
  only to `127.0.0.1`, checks Host/Origin and emits no permissive CORS headers.
- Provider URLs, resolved addresses and every redirect are checked. The socket
  uses the checked DNS addresses. Private, loopback, link-local and special-use
  provider destinations are blocked. The app's own loopback transport is separate.
- Native HTTP does not use a system cookie store or HTTP proxy environment.
  The UI selects cookies from that source author's jar at every redirect. Custom
  secrets and authorization are stripped across origins. Set-Cookie lines stay
  separate and redirect cookies are returned with their issuing URLs.
- Metadata requests are bounded to 8 MiB and 16 concurrent host operations.
  Playback streams bytes through separate leased URLs, supports Range/206,
  and rewrites ordinary HLS playlists, segments, keys, maps and subtitle URLs.
  Media headers/explicit cookies remain tied to the original origin, with
  credentials stripped on cross-origin hops. Media response cookies are not
  persisted into provider jars. Leases expire and explicit release revokes URLs.
- The browser tests use the real Node/Rust hosts with the production builds and
  no extension. They check startup, hash routes/reload, empty providers/sources,
  and blocked private destinations. Node transport tests additionally exercise
  protected HLS rewriting/ranges and revocation against a local fixture.

Interactive WAF verification is **not implemented on these TV wrappers**; the
shared consent settings remain, and verification fails explicitly. DRM/DASH,
variable/low-latency HLS, provider-specific anti-bot behavior, remote media keys,
long playback, focus/back/exit behavior and real hardware codecs need device QA.
The common player's runtime WASM currently retains its existing CDN dependency.

## Platform references

- [LG JS service packaging](https://webostv.developer.lge.com/develop/guides/js-service-usage)
- [LG service Node versions](https://webostv.developer.lge.com/develop/guides/js-service-basics)
- [LG web engine versions](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine)
- [LG ACG declarations](https://webostv.developer.lge.com/develop/guides/acg-guide)
- [Amazon build templates and VPKG output](https://developer.amazon.com/docs/vega/latest/build-an-app)
- [Amazon WebView and HTTP policy](https://www.developer.amazon.com/docs/vega/0.24/develop-your-app-with-webview)
- [Amazon TurboModule codegen/CMake](https://www.developer.amazon.com/docs/vega/0.23/create-turbo-module)
