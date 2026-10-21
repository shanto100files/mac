/** Provider format is authoritative even for signed URLs without an extension. */
export function hasHlsHint(
  source: string,
  streamType?: string,
  headers: Record<string, string> = {},
): boolean {
  const type = (streamType || '').trim().toLowerCase();
  const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
  return type === 'hls' || type === 'm3u8' || type.includes('mpegurl') ||
    source.toLowerCase().includes('m3u8') || contentType.toLowerCase().includes('mpegurl');
}
