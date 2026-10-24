// FFmpeg may use the host C runtime, but must carry its own media libraries.
// Mixing bundled/system libavutil and libva can fail during symbol resolution.
export function systemMediaDependencies(dynamicSection) {
  return [...dynamicSection.matchAll(/\(NEEDED\).*?Shared library:\s*\[([^\]]+)\]/g)]
    .map((match) => match[1])
    .filter((name) => /^lib(?:avcodec|avformat|avutil|avfilter|avdevice|swscale|swresample|postproc|va(?:-[\w-]+)?)\.so(?:\.|$)/.test(name));
}
