import {invoke} from '@tauri-apps/api/core';
import type {MediaSourceDescriptor} from '@vega/libmedia-engine/core/media';

/** Desktop's existing byte-preserving proxy; never asks FFmpeg to transcode. */
export async function prepareTauriMediaSource(source: MediaSourceDescriptor): Promise<MediaSourceDescriptor> {
  if (typeof source.source !== 'string' || /^(blob:|asset:|https?:\/\/(?:127\.0\.0\.1|localhost)(?=[:/]))/i.test(source.source)) {
    return {...source, headers: undefined};
  }
  const port = await invoke<number>('get_stream_proxy_port');
  if (!port) throw new Error('Desktop media delivery is unavailable');
  const base = `http://127.0.0.1:${port}`;
  let url: string;
  if (source.source.startsWith('local://')) {
    url = `${base}/local/${encodeURIComponent(source.source.slice('local://'.length))}/media`;
  } else if (!/^https?:/i.test(source.source)) {
    const file = source.source.startsWith('file:') ? decodeURIComponent(new URL(source.source).pathname).replace(/^\/(?=[A-Za-z]:)/, '') : source.source;
    url = `${base}/file?path=${encodeURIComponent(file)}`;
  } else {
    const query = new URLSearchParams({url: source.source, headers: JSON.stringify(source.headers || {})});
    const hls = /hls|m3u8|mpegurl/i.test(source.format || '') || /\.m3u8(?:[?#]|$)/i.test(source.source);
    url = `${base}/${hls ? 'playlist.m3u8' : 'source'}?${query}`;
  }
  return {...source, source: url, headers: undefined};
}
