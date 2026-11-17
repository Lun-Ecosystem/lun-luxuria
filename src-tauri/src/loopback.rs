//! The loopback rule, shared by the service's arguments and the program probe. Read by hand, without a URL
//! parser: the service reads the address again with httpx, and two parsers that differ would let a host through.

const HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];

/**
 * `http://` or `https://`, one of `HOSTS`, an optional port (1 to 65535), one `/` at most; scheme and host in any
 * case, nothing else. Gives `host:port`, the host in lowercase, the scheme's port when there is none.
 */
pub fn addr(url: &str) -> Option<String> {
    let url = url.to_ascii_lowercase();
    let (rest, default) = match url.strip_prefix("http://") {
        Some(rest) => (rest, 80),
        None => (url.strip_prefix("https://")?, 443),
    };
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let (host, port) = HOSTS
        .iter()
        .find_map(|h| rest.strip_prefix(h).map(|p| (h, p)))?;
    let port = match port.strip_prefix(':') {
        None if port.is_empty() => default,
        // Digits only: `u16` would read `+80`, which httpx may not.
        Some(p) if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) => {
            p.parse::<u16>().ok().filter(|&n| n != 0)?
        }
        _ => return None,
    };
    Some(format!("{host}:{port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One test per address; `addr` gives `host:port`, the scheme's port when there is none.
    macro_rules! admitted {
        ($($name:ident: $url:expr => $want:expr;)*) => {$(
            #[test]
            fn $name() {
                assert_eq!(addr($url).as_deref(), Some($want));
            }
        )*};
    }
    macro_rules! refused {
        ($($name:ident: $url:expr;)*) => {$(
            #[test]
            fn $name() {
                assert_eq!(addr($url), None, "{} must be refused", $url);
            }
        )*};
    }

    admitted! {
        ipv4_with_port: "http://127.0.0.1:8080" => "127.0.0.1:8080";
        ipv4_without_port_gets_the_http_port: "http://127.0.0.1" => "127.0.0.1:80";
        ipv4_with_trailing_slash: "http://127.0.0.1:8080/" => "127.0.0.1:8080";
        ipv4_without_port_with_slash: "http://127.0.0.1/" => "127.0.0.1:80";
        localhost_with_port: "http://localhost:11434" => "localhost:11434";
        localhost_without_port: "http://localhost" => "localhost:80";
        localhost_with_trailing_slash: "http://localhost:8788/" => "localhost:8788";
        ipv6_with_port: "http://[::1]:8788" => "[::1]:8788";
        ipv6_without_port: "http://[::1]" => "[::1]:80";
        ipv6_with_trailing_slash: "http://[::1]:8788/" => "[::1]:8788";
        https_without_port_gets_the_https_port: "https://127.0.0.1" => "127.0.0.1:443";
        https_localhost_with_port: "https://localhost:8443/" => "localhost:8443";
        https_ipv6_without_port: "https://[::1]/" => "[::1]:443";
        highest_port: "http://localhost:65535" => "localhost:65535";
        lowest_port: "http://localhost:1" => "localhost:1";
    }

    #[test]
    fn scheme_and_host_ignore_case() {
        assert!(addr("HTTP://LocalHost:8080").is_some());
        assert!(addr("Https://LOCALHOST/").is_some());
    }

    refused! {
        user_info_hides_the_real_host: "http://127.0.0.1:8080@example.com";
        user_info_before_a_loopback_host: "http://user@127.0.0.1:8080";
        subdomain_lookalike: "http://127.0.0.1.example:8080";
        other_loopback_address: "http://127.0.0.2:8080";
        mapped_ipv6: "http://[::ffff:127.0.0.1]:8080";
        other_ipv6: "http://[::2]:8080";
        a_path: "http://localhost:8080/inference";
        a_query: "http://localhost:8080?x=1";
        a_query_after_a_slash: "http://localhost:8080/?x=1";
        a_fragment: "http://localhost:8080#x";
        two_slashes: "http://localhost:8080//";
        port_zero: "http://127.0.0.1:0";
        port_too_high: "http://127.0.0.1:65536";
        port_not_a_number: "http://127.0.0.1:80a";
        empty_port: "http://127.0.0.1:";
        another_scheme: "ftp://127.0.0.1";
        no_scheme: "127.0.0.1:8080";
        empty: "";
        scheme_only: "http://";
        a_space_around: " http://127.0.0.1:8080";
        a_foreign_host: "http://example.com";
        a_lookalike_localhost: "http://localhost.example:8080";
        // `u16` reads `+80`: only the digits check refuses it.
        a_plus_sign_before_the_port: "http://127.0.0.1:+80";
        a_trailing_dot_after_localhost: "http://localhost.:8080";
        a_trailing_dot_after_the_ipv4: "http://127.0.0.1.:8080";
        a_short_ipv4: "http://127.1:8080";
        a_percent_encoded_host: "http://127.0.0.%31:8080";
        // A WHATWG parser drops a tab anywhere; httpx does not.
        a_tab_in_the_port: "http://127.0.0.1:80\t80";
    }
}
