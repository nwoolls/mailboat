//! Hosts on the reader's own computer or network, which an email's images
//! never load from.
//!
//! An email's remote image is a request the sender chooses. Pointed at
//! `127.0.0.1`, a `*.local` name or a router's `192.168.…` address, it would
//! make the reader's computer ask a device on their own network for
//! something, with the reader's network position and no click (a printer's
//! or router's web page, a local development server). No mail needs that:
//! a sender's images live on the public web. So the cleaner removes such an
//! image as it removes an unsafe address (`mail::sanitize`), and the
//! downloader that fetches images as mail arrives (`mail::prefetch`) refuses
//! a public name that resolves to one, or a redirect that leads to one.
//!
//! What counts as local:
//! - addresses: loopback, private (RFC 1918), shared (`100.64.0.0/10`,
//!   carrier-grade NAT and Tailscale), link-local, unspecified, broadcast
//!   and multicast, IPv6 unique-local, link-local and multicast, and an IPv4
//!   address written inside an IPv6 one;
//! - names: `localhost` and names under it, and the names local networks
//!   use but the public web can't (`.local`, `.internal`, `.home.arpa`,
//!   `.lan`), plus a name with no dot at all (`http://router/`), which the
//!   system looks up on the local network.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Whether `host` is on the reader's own computer or network.
pub fn is_local_host(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(name) => is_local_name(name),
        url::Host::Ipv4(ip) => is_local_ipv4(*ip),
        url::Host::Ipv6(ip) => is_local_ipv6(*ip),
    }
}

/// Whether an address is on the reader's own computer or network.
pub fn is_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_local_ipv4(ip),
        IpAddr::V6(ip) => is_local_ipv6(ip),
    }
}

/// Names a local network uses: see the top. `url` has already lowercased
/// the name and turned a numeric one (`2130706433`, `0x7f.1`) into an
/// address, so only real names get here.
fn is_local_name(name: &str) -> bool {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    !name.contains('.')
        || ["localhost", "local", "internal", "home.arpa", "lan"]
            .iter()
            .any(|suffix| name == *suffix || name.ends_with(&format!(".{suffix}")))
}

fn is_local_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (64..128).contains(&b))
}

fn is_local_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return is_local_ipv4(v4);
    }
    // An IPv4 address written the old way (`::127.0.0.1`), `::1` and `::`
    // included: judged as that IPv4 address.
    if ip.segments()[..6].iter().all(|s| *s == 0) {
        let [.., a, b, c, d] = ip.octets();
        return is_local_ipv4(Ipv4Addr::new(a, b, c, d));
    }
    let first = ip.segments()[0];
    ip.is_multicast() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host_of(address: &str) -> bool {
        let url = url::Url::parse(address).unwrap();
        is_local_host(&url.host().unwrap())
    }

    #[test]
    fn the_readers_own_computer_and_network_are_local() {
        for address in [
            "https://127.0.0.1/a.png",
            "https://127.1.2.3/a.png",
            "https://2130706433/a.png",
            "https://0x7f.1/a.png",
            "https://0.0.0.0/a.png",
            "https://10.0.0.5/a.png",
            "https://172.16.0.1/a.png",
            "https://172.31.255.255/a.png",
            "https://192.168.1.1/a.png",
            "https://169.254.169.254/a.png",
            "https://100.64.0.1/a.png",
            "https://100.127.255.255/a.png",
            "https://255.255.255.255/a.png",
            "https://224.0.0.1/a.png",
            "https://[::1]/a.png",
            "https://[::]/a.png",
            "https://[fd00::1]/a.png",
            "https://[fe80::1]/a.png",
            "https://[::ffff:127.0.0.1]/a.png",
            "https://[::ffff:192.168.0.1]/a.png",
            "https://[::7f00:1]/a.png",
            "https://localhost/a.png",
            "https://LOCALHOST./a.png",
            "https://app.localhost/a.png",
            "https://printer.local/a.png",
            "https://nas.internal/a.png",
            "https://router.home.arpa/a.png",
            "https://router.lan/a.png",
            "https://router/a.png",
        ] {
            assert!(host_of(address), "{address} should be local");
        }
    }

    #[test]
    fn the_public_web_is_not_local() {
        for address in [
            "https://images.x.example/a.png",
            "https://example.com/a.png",
            "https://8.8.8.8/a.png",
            "https://172.32.0.1/a.png",
            "https://100.128.0.1/a.png",
            "https://[2001:db8::1]/a.png",
            "https://[::ffff:8.8.8.8]/a.png",
            "https://[::8.8.8.8]/a.png",
            "https://localhost.x.example/a.png",
            "https://local.x.example/a.png",
        ] {
            assert!(!host_of(address), "{address} should not be local");
        }
    }
}
