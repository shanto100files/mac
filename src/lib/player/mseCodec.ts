/** VP9/AV1 MIME declarations must match the profile and bit depth being copied. */
export function modernVideoCodec(
  codec: string,
  profile?: string,
  bitDepth?: number,
): string | undefined {
  const name = codec.toLowerCase();
  const depth = bitDepth || (/profile\s*[23]/i.test(profile || "") ? 10 : 8);
  if (name.includes("vp9") || name.includes("vp09")) {
    const number = Number(profile?.match(/profile\s*(\d)/i)?.[1] ?? (depth > 8 ? 2 : 0));
    return `vp09.${String(number).padStart(2, "0")}.51.${String(depth).padStart(2, "0")}`;
  }
  if (name.includes("av1") || name.includes("av01")) {
    const number = /high/i.test(profile || "") ? 1 : /professional/i.test(profile || "") ? 2 : 0;
    return `av01.${number}.08M.${String(depth).padStart(2, "0")}`;
  }
  return undefined;
}

export function modernMseMime(codec: string, hasAudio: boolean, profile?: string, bitDepth?: number): string | undefined {
  const video = modernVideoCodec(codec, profile, bitDepth);
  return video ? `video/mp4; codecs="${video}${hasAudio ? ", mp4a.40.2" : ""}"` : undefined;
}
