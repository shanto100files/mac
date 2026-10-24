# Libmedia engine

Playback, seeking, codec diagnostics, embedded audio/subtitles and libmedia
patches come from `@vega/libmedia-engine`. Its source is maintained at
`vega-site/packages/libmedia-engine`. Desktop consumes the versioned archive
in `vendor/`, rather than keeping a second implementation. Normal `npm install`,
`npm run dev` and `npm run build` work without the site checkout.

To bring shared changes into desktop:

```powershell
npm run sync:libmedia
npm run test:libmedia
npm run test:libmedia:browser
npm run build
```

Commit the updated archive, package manifest and lockfile. To use a different
source directory: `npm run sync:libmedia -- C:\path\to\libmedia-engine`.

Desktop's existing loopback server delivers local files, original remote byte
ranges and rewritten HLS references with provider headers. Libmedia does its
own demuxing/decoding; this engine does not request FFmpeg remux/transcode.
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
