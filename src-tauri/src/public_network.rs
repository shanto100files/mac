use std::net::IpAddr;

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 2 && c == 0)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return is_public_ip(IpAddr::V4(v4));
            }
            let b = ip.octets();
            (b[0] & 0xe0) == 0x20
                && !(b[0] == 0x20 && b[1] == 2)
                && !(b[0] == 0x20 && b[1] == 1 && (b[2] < 2 || (b[2] == 0x0d && b[3] == 0xb8)))
        }
    }
}

pub fn validate_url(value: &str) -> Result<(), String> {
    let url = url::Url::parse(value).map_err(|_| "Invalid provider URL")?;
    let host = url
        .host_str()
        .unwrap_or("")
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_lowercase();
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || host.is_empty()
        || (!host.contains('.') && !host.contains(':'))
        || [
            "localhost",
            "local",
            "internal",
            "lan",
            "home",
            "test",
            "invalid",
        ]
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        || host.ends_with(".home.arpa")
        || host
            .parse::<IpAddr>()
            .map(|ip| !is_public_ip(ip))
            .unwrap_or(false)
    {
        return Err("Provider destination is blocked: public HTTP(S) servers only".into());
    }
    Ok(())
}

pub fn validate_addresses(addresses: &[IpAddr]) -> Result<(), String> {
    if addresses.is_empty() || addresses.iter().any(|ip| !is_public_ip(*ip)) {
        return Err("Provider DNS resolved to a blocked or empty destination".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_special_and_mapped_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "192.168.1.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::",
        ] {
            assert!(!is_public_ip(address.parse().unwrap()), "{address}");
        }
        for address in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(is_public_ip(address.parse().unwrap()), "{address}");
        }
    }
    #[test]
    fn checks_redirect_urls_and_mixed_dns_results() {
        for value in [
            "http://2130706433/",
            "http://0x7f000001/",
            "http://[::1]/",
            "http://localhost./",
            "http://router.home.arpa/",
            "file:///secret",
        ] {
            assert!(validate_url(value).is_err(), "{value}");
        }
        assert!(
            validate_addresses(&["1.1.1.1".parse().unwrap(), "10.0.0.1".parse().unwrap()]).is_err()
        );
        assert!(validate_url("https://provider.example/").is_ok());
    }
}
