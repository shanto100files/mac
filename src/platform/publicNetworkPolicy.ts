import ipaddr from 'ipaddr.js';

/** Public destinations only; URL normalizes numeric/hex IPv4 before this check. */
export function isPublicAddress(value: string): boolean {
  try {
    const ip = ipaddr.process(value.replace(/^\[|\]$/g, ''));
    if (ip.range() !== 'unicast') return false;
    if (ip.kind() === 'ipv6') {
      const bytes = ip.toByteArray();
      // IPv6 global unicast only. Refuse transition/documentation/benchmark ranges.
      return (bytes[0] & 0xe0) === 0x20 && !(bytes[0] === 0x20 && bytes[1] === 0x02) &&
        !(bytes[0] === 0x20 && bytes[1] === 0x01 && (bytes[2] < 2 || bytes[2] === 0x0d && bytes[3] === 0xb8));
    }
    return true;
  } catch {return false;}
}
export function publicHttpUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !hostname ||
      !hostname.includes('.') && !hostname.includes(':') ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(hostname) || hostname.endsWith('.home.arpa') ||
      (ipaddr.isValid(hostname) && !isPublicAddress(hostname))) throw new Error('Provider destination is blocked: only public HTTP(S) servers are allowed.');
  return url;
}
