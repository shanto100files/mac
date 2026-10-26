import type {MediaSourceDescriptor} from '@vega/libmedia-engine/core/media';
import {isTorrentSource} from '@vega/libmedia-engine/torrent-source';
import {assertBrowserHeaders, getPlatformHost, isTauriRuntime, PlatformAccessError, waitForPlatformHost, requirePublicDestinationChecks} from './host';

const owners = new WeakMap<MediaSourceDescriptor, (id: string) => Promise<void>>();

export async function releaseMediaSource(source?: MediaSourceDescriptor): Promise<void> {
  if (!source) return;
  const release = owners.get(source); owners.delete(source);
  if (release) await release(source.id);
}

/** Source preparation belongs to the host, not the shared decoding engine. */
export async function prepareMediaSource(source: MediaSourceDescriptor): Promise<MediaSourceDescriptor> {
  if (isTorrentSource(source.source,source.format)) {
    if (!isTauriRuntime()) return {...source,headers:undefined};
    const {resolveTorrentStreamUrl} = await import('../lib/services/torrentStreamService');
    return {...source,source:await resolveTorrentStreamUrl(source.source),format:undefined,headers:undefined};
  }
  if (isTauriRuntime()) {
    const {prepareTauriMediaSource} = await import('./tauri/mediaDelivery');
    return prepareTauriMediaSource(source);
  }
  if (typeof source.source !== 'string' || /^(blob:|data:)/i.test(source.source)) return {...source, headers: undefined};
  await waitForPlatformHost();
  const host = getPlatformHost();
  if (host?.capabilities.mediaDelivery && host.prepareMediaSource) {
    requirePublicDestinationChecks(host);
    const delivered = await host.prepareMediaSource({...source, headers: {...source.headers}});
    if (host.releaseMediaSource) owners.set(delivered, host.releaseMediaSource.bind(host));
    return delivered;
  }
  assertBrowserHeaders(new Headers(source.headers));
  if (typeof source.source === 'string' && !/^(https?:|blob:|data:)/i.test(source.source)) {
    throw new PlatformAccessError('HOST_REQUIRED', 'This media source requires an installed app host or a browser-selected file.');
  }
  return {...source};
}
