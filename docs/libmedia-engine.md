# Libmedia engine

Playback, seeking, codec diagnostics, embedded audio/subtitles and libmedia
patches come from `@vega/libmedia-engine`. Its source is maintained at
[vega-org/web-player-engine](https://github.com/vega-org/web-player-engine).
Desktop and Cast install the same exact Git commit directly from GitHub over HTTPS.
There is no npm publication, vendored archive or sibling checkout requirement.
Normal `npm ci`, development and release builds fetch the pinned dependency.

After committing and pushing an engine change, update both consumers:

```sh
npm install --ignore-scripts --save-exact @vega/libmedia-engine@https://codeload.github.com/vega-org/web-player-engine/tar.gz/<full-commit-sha>
```

In Vega Site, add `--workspace @vega/web-cast`. Commit the manifests and
lockfiles, run the engine/host tests and rebuild each app. GitHub access is
needed at dependency installation, not at runtime.

Desktop's existing loopback server delivers local files, original remote byte
ranges and rewritten HLS references with provider headers. Libmedia does its
own demuxing/decoding; this engine does not request FFmpeg remux/transcode.
Source preparation now lives in the platform layer rather than inside the
player adapter; see [platform networking](platform-networking.md). Browser and
TV hosts use that same boundary without depending on a Chrome extension.
External subtitles are listed from metadata and downloaded only when selected.
HLS qualities use the existing quality menu when libmedia exposes alternatives.

The browser regression generates a small synthetic MKV with the desktop's
FFmpeg fixture tool and verifies actual libmedia playback, embedded languages,
seeking, source replacement and cleanup in Chrome. It requires installed Chrome
and the desktop FFmpeg tools; it does not establish Tauri WebView, HDR, 4K,
hardware acceleration or platform codec support.

The existing subtitle Customize menu applies saved font, size, weight, text and
outline colors, outline width, shadow effects and bottom padding to libmedia's
text subtitles immediately. Size and padding follow the desktop 1080-line
reference scale when the window resizes. Libmedia retains subtitle timing and
layout; bitmap/drawn subtitles are not recolored as text.

Libmedia currently has no exposed audio-delay setter or chapter integration in
this adapter. Other native mpv-specific properties are
not emulated. Decoder WASM assets retain the shared engine's pinned CDN default,
so fully offline decoder availability has not been established.
