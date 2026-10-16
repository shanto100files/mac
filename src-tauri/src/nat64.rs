//! RFC 7050 prefix discovery and RFC 6052 address synthesis for DNS64 networks.
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Nat64Prefix {
    bytes: [u8; 16],
    length: usize,
}

impl Nat64Prefix {
    pub fn from_discovery_address(address: Ipv6Addr) -> Option<Self> {
        if address.to_ipv4_mapped().is_some() || address.is_multicast() || address.is_loopback() {
            return None;
        }
        let bytes = address.octets();
        for length in [96, 64, 56, 48, 40, 32] {
            let mut prefix = Self {
                bytes: [0; 16],
                length,
            };
            prefix.bytes[..length / 8].copy_from_slice(&bytes[..length / 8]);
            if [Ipv4Addr::new(192, 0, 0, 170), Ipv4Addr::new(192, 0, 0, 171)]
                .iter()
                .any(|ipv4| prefix.synthesize(*ipv4) == address)
            {
                return Some(prefix);
            }
        }
        None
    }

    pub fn synthesize(&self, address: Ipv4Addr) -> Ipv6Addr {
        let mut bytes = self.bytes;
        let mut position = self.length / 8;
        for byte in address.octets() {
            // RFC 6052 reserves octet 8 for prefix lengths shorter than /96.
            if position == 8 {
                position += 1;
            }
            bytes[position] = byte;
            position += 1;
        }
        Ipv6Addr::from(bytes)
    }
}

pub fn order_addresses(ips: Vec<IpAddr>, prefixes: &[Nat64Prefix]) -> Vec<IpAddr> {
    if prefixes.is_empty() {
        return ips;
    }
    let ipv4: Vec<_> = ips
        .iter()
        .filter_map(|ip| {
            if let IpAddr::V4(ip) = ip {
                Some(*ip)
            } else {
                None
            }
        })
        .collect();
    let mut ipv6: Vec<_> = ips
        .iter()
        .filter_map(|ip| {
            if let IpAddr::V6(ip) = ip {
                Some(*ip)
            } else {
                None
            }
        })
        .collect();
    for address in &ipv4 {
        for prefix in prefixes {
            ipv6.push(prefix.synthesize(*address));
        }
    }
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    // Keep both families within the relay's bounded connection attempts.
    for index in 0..ipv4.len().max(ipv6.len()) {
        if let Some(address) = ipv6.get(index) {
            let ip = IpAddr::V6(*address);
            if seen.insert(ip) {
                result.push(ip);
            }
        }
        if let Some(address) = ipv4.get(index) {
            let ip = IpAddr::V4(*address);
            if seen.insert(ip) {
                result.push(ip);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_the_network_prefix_from_both_ipv4only_arpa_answers() {
        let a = Nat64Prefix::from_discovery_address("64:ff9b::c000:aa".parse().unwrap()).unwrap();
        let b = Nat64Prefix::from_discovery_address("64:ff9b::c000:ab".parse().unwrap()).unwrap();
        assert_eq!(a, b);
        assert_eq!(
            a.synthesize(Ipv4Addr::new(18, 66, 78, 70)),
            "64:ff9b::1242:4e46".parse::<Ipv6Addr>().unwrap()
        );
    }
    #[test]
    fn supports_every_rfc6052_prefix_length() {
        for length in [32, 40, 48, 56, 64, 96] {
            let mut prefix = Nat64Prefix {
                bytes: [0; 16],
                length,
            };
            prefix.bytes[..4].copy_from_slice(&[0x20, 0x01, 0x0d, 0xb8]);
            let discovery = prefix.synthesize(Ipv4Addr::new(192, 0, 0, 170));
            assert_eq!(Nat64Prefix::from_discovery_address(discovery), Some(prefix));
        }
    }
    #[test]
    fn rejects_ordinary_ipv6_addresses_as_prefix_discovery() {
        for ip in [
            "2001:db8::1",
            "::1",
            "64:ff9b::c000:ac",
            "::ffff:192.0.0.170",
        ] {
            assert_eq!(
                Nat64Prefix::from_discovery_address(ip.parse().unwrap()),
                None
            );
        }
    }
    #[test]
    fn preserves_doh_targets_and_keeps_ipv4_fallback_in_the_first_two_attempts() {
        let prefix =
            Nat64Prefix::from_discovery_address("64:ff9b::c000:aa".parse().unwrap()).unwrap();
        let ips = vec![
            "18.66.78.70".parse().unwrap(),
            "18.66.78.40".parse().unwrap(),
        ];
        assert_eq!(
            order_addresses(ips, &[prefix]),
            [
                "64:ff9b::1242:4e46",
                "18.66.78.70",
                "64:ff9b::1242:4e28",
                "18.66.78.40"
            ]
            .map(|ip| ip.parse::<IpAddr>().unwrap())
        );
    }
    #[test]
    fn deduplicates_native_and_synthesized_ipv6_addresses() {
        let prefix =
            Nat64Prefix::from_discovery_address("64:ff9b::c000:aa".parse().unwrap()).unwrap();
        let ips = ["64:ff9b::1242:4e46", "18.66.78.70", "18.66.78.70"]
            .map(|ip| ip.parse().unwrap())
            .to_vec();
        assert_eq!(order_addresses(ips, &[prefix]).len(), 2);
    }
    #[test]
    fn preserves_existing_behavior_on_networks_without_dns64() {
        let ips = ["2001:db8::1", "18.66.78.70"]
            .map(|ip| ip.parse().unwrap())
            .to_vec();
        assert_eq!(
            order_addresses(ips, &[]),
            ["2001:db8::1", "18.66.78.70"].map(|ip| ip.parse::<IpAddr>().unwrap())
        );
    }
}
