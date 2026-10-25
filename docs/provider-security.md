# Provider execution and transport boundaries

Provider JavaScript is untrusted. The shared Desktop/web frontend executes it in
QuickJS 0.32.0 compiled to WebAssembly, inside a dedicated browser Worker per
operation. The extension remains an optional network/media adapter. It never
executes provider JavaScript in its privileged background worker. No provider or
provider source is bundled or installed by these changes.

## Execution

`providerSandbox.worker.ts` contains trusted transport. Provider code, Axios,
Cheerio, timers, URL/base64 helpers and provider state live in the VM's separate
heap. Only JSON strings cross the VM boundary. Functions exposed through QuickJS
are VM functions; their constructors/prototypes cannot recover browser globals.
There is no module loader, browser DOM, native fetch, WebSocket, browser cookie
store, filesystem or extension API in that environment. Provider `fetch` and Axios
use a checked message bridge. Code generation remains available inside QuickJS
for extractor compatibility; it does not execute in the host JavaScript realm.
The SDK implements the provider APIs exercised by the compatibility tests; it is
not a full browser environment. DOM, browser storage, streaming bodies, FormData,
Blob and arbitrary browser-module imports are not exposed. Providers requiring
additional APIs need explicit VM implementations rather than host object access.

The VM has a 128 MiB allocation limit, 512 KiB stack limit and five seconds of
execution budget across evaluation/job processing. The operation deadline is 120
seconds, including network or user interaction. Cancellation terminates the
worker and cancels outstanding host operations where supported. Three operations
may run concurrently; up to 32 wait for a slot. Each operation permits 16 pending
requests and 256 total bridge operations. Timers and digest inputs are bounded.
Metadata responses are limited to 8 MiB while reading, serialized results to 8
MiB, and individual modules to two million characters. These are not a total
process-memory guarantee: browser/WASM/SDK overhead exists outside the VM heap.

Build/dev commands generate the bundled SDK from `providerSdk.ts`, its polyfills
and pinned dependencies. `scripts/setup-provider-sandbox.mjs` also emits dependency
notices into the app's public assets. Generated files contain SDK code only.

## Requests and credentials

The parent app owns provider identity and storage scope; identity supplied in a
provider message is not trusted. Cookies remain scoped by source author, with
host/path/Secure/expiry matching. Providers from the same source share that cookie
scope. They can use and disclose information legitimately available to that
source, including its provider credentials. The bridge does not read normal
Chrome login cookies. Explicit allowed network access can still send data to a
provider-controlled server.

Initial provider URLs reject credentials, local names, private/special IP ranges,
numeric/hex IPv4 aliases, mapped private IPv6 and transition ranges. Provider
stream/subtitle outputs cannot name local files/directories or private IP URLs.
Magnet stream links retain the existing torrent route.

Native provider HTTP checks every redirect, selects cookies again for its target
and strips custom secrets/authorization when the origin changes. Its custom DNS
resolver validates the complete address set and supplies those addresses directly
to the HTTP client's connection resolver, including system-DNS fallback. Remote
media DNS and redirects also enforce the destination policy. Local-file playback
uses its separate existing routes. The app-owned ByeDPI relay validates both DNS
and literal IP targets and remains available for provider HTTP. Other active
proxies (including the current WARP HTTP proxy) fail explicitly for provider HTTP
and remote media through the native app proxy,
because they can bypass connection-address enforcement. There is no unchecked
proxy fallback. External/native players that perform their own network requests
are outside this connection-resolver boundary. Native request work has finite connection/request limits
even when a frontend cancellation cannot abort an in-flight native invocation.

Extension 0.4.0 checks URLs and performs public DNS preflight for metadata hops,
verification targets and prepared media resources. DNS failures and any private
or empty address set fail closed. The preflight uses credential-free HTTPS DNS
requests to Cloudflare; that service receives the target hostname. Hosts must
advertise `publicDestinationChecks` for provider traffic, verification and media;
older extension builds receive an update-required error.

**Browser limitation:** extension fetch and browser media delivery cannot pin the
actual connection to the preflight addresses. Browser/proxy DNS can differ or
change after validation. This is defense in depth, not a complete DNS-rebinding
defense. Direct CORS-permitted browser provider HTTP omits credentials, checks URL
literals and refuses opaque/unchecked redirects; it relies on browser network
restrictions for resolved destinations. An outbound service/transport that pins
validated addresses is required for the same destination guarantee as native.

## App and source trust

Production HTML has a script CSP allowing bundled scripts, WASM and hashed startup
code. Unlisted inline JavaScript, browser eval, embedded frames, objects, forms and
base-URL changes are blocked. Development retains Vite's normal debugging behavior.
This reduces script injection risk; it does not make a compromised app origin
safe. The extension deliberately trusts the Vega app and localhost development
origins, so other scripts executing there can invoke its bridge. Localhost on all
ports remains a development trust decision, not a per-process identity check.

Remote source code downloads require HTTPS. Explicit manually added localhost
development sources can use HTTP. A manifest may supply an `integrity` object
mapping module names (`posts`, `meta`, `stream`, `catalog`, `episodes`, `settings`)
to SHA-256 hex digests. A declaration must cover all required modules, and every
included module is verified before the cache/install changes. Missing/modified
declared modules fail installation/update. Existing unsigned sources continue to
work as untrusted code. These hashes are not publisher signatures: a compromised
repository that can change the manifest and code can change both. Independently
pinned signing keys and publisher signatures are not implemented.

Interactive verification still has a separate shared Block/Ask/Allow gate. Browser
verification reads only private `cf_clearance`, not account cookies or DOM. Native
verification retains its existing provider-script compatibility in a private
WebView. Personal information entered in either provider page remains subject to
that page's behavior and the warning shown before opening it.

## Optional browser host access

Extension 0.5.0 requires only Vega/local host access on a fresh installation.
All HTTP(S) origins are optional and requested together through the packaged
popup's **Allow all websites** button, inside a user gesture. Background/provider
requests never invoke a permission prompt. Before approval, privileged operations
are blocked. Chrome remembers approval for future domains. Revoking access stops
pending work and removes media rules/blob resources; owned verification windows
are closed. Existing approved permissions may survive an upgrade. The grant
changes where the extension can make requests, not where its page bridge runs:
only Vega/local origins can use that bridge.

## Provider automatic updates

Settings → Preferences → Auto update providers is available in the shared
desktop/web/TV frontend and the mobile/Android TV app. It defaults to enabled,
preserving existing behavior, and is saved as `autoUpdateProviders` independently
of app-update preferences. Disabling it stops automatic update work on startup,
timers, focus and source-refresh flows. Manual checks and explicit Update actions
remain available in Extensions. Re-enabling starts a fresh check.

Automatic jobs recheck the preference after manifest loading and before each
provider. Update downloads are staged without replacing cached executable code;
the preference is checked again immediately before committing code and the
installed version. Turning it off while a download is in progress prevents that
automatic update from being applied. No provider or source is added by this
setting, and uninstalls during an update remain effective.

## Validation

`npm run test:security` exercises destination checks, native redirect credential
handling, module hashes, execution slots and the actual browser VM. The browser
regressions reproduce the former constructor/prototype escape, try host-function
constructors and remote imports, test SDK compatibility, memory/CPU bounds and
cancellation. `npm run test:web` also installs an explicitly chosen fixture
provider and reaches actual shared-player playback through the compiled worker
under production CSP. Real extension tests use temporary test copies with exactly
their controlled local fixture origins permitted; production has no such bypass.
The production URL/DNS guard is separately tested without those exemptions.

Run Playwright suites sequentially because they share test-artifact directories.
These checks do not establish arbitrary live-provider, TV hardware or actual
native WebView compatibility, and are not a complete security audit.
