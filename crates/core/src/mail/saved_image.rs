//! Saving or copying an image shown inside an email (its right-click
//! menu). The image's address is what the email's `<img>` shows: a
//! `data:` URL (inline images, embedded by `attachments`) or a web
//! address (remote images, which only show when they're allowed to load).

use base64::Engine;

use crate::gmail::client::net_error;
use crate::{CoreError, Result};

/// The largest image Mailboat will save or copy (an email image is rarely
/// over a few MB; this stops a link to something huge filling memory).
pub const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// An email's image, ready to save or copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailImage {
    pub bytes: Vec<u8>,
    /// `image/png`, `image/jpeg`…
    pub mime: String,
    /// A name to save it under (made safe by `attachments::unique_path`).
    pub filename: String,
}

/// Gets an email image's bytes: decoded from a `data:` URL, or fetched
/// from the web. Anything but an image is refused.
pub async fn load(http: &reqwest::Client, src: &str) -> Result<EmailImage> {
    if src.starts_with("data:") {
        return from_data_url(src);
    }
    let (bytes, mime, url) = fetch_web_image(http, src, MAX_IMAGE_BYTES).await?;
    let filename = filename_for(&url, &mime);
    Ok(EmailImage {
        bytes,
        mime,
        filename,
    })
}

/// Fetches an image from the web (http or https only): its bytes, type and
/// final address. Anything but an image, or over `max` bytes, is refused.
pub async fn fetch_web_image(
    http: &reqwest::Client,
    src: &str,
    max: usize,
) -> Result<(Vec<u8>, String, url::Url)> {
    let url = url::Url::parse(src).map_err(|_| not_an_image())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(not_an_image());
    }
    let mut response = http
        .get(url.clone())
        .send()
        .await
        .map_err(net_error)?
        .error_for_status()
        .map_err(net_error)?;
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .unwrap_or_default();
    if !mime.starts_with("image/") {
        return Err(not_an_image());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(net_error)? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > max {
            return Err(CoreError::Invalid(format!(
                "the image is too large (over {} MB)",
                max / (1024 * 1024)
            )));
        }
    }
    Ok((bytes, mime, url))
}

fn not_an_image() -> CoreError {
    CoreError::Invalid("that isn't an image Mailboat can save".into())
}

/// `data:image/png;base64,iVBOR…` (or a percent-encoded `data:` URL, as
/// SVGs sometimes are).
fn from_data_url(src: &str) -> Result<EmailImage> {
    let rest = src.strip_prefix("data:").ok_or_else(not_an_image)?;
    let (meta, data) = rest.split_once(',').ok_or_else(not_an_image)?;
    let mut parts = meta.split(';');
    let mime = parts.next().unwrap_or("").trim().to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return Err(not_an_image());
    }
    let bytes = if parts.any(|p| p.eq_ignore_ascii_case("base64")) {
        let compact: String = data.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD
            .decode(compact)
            .map_err(|_| not_an_image())?
    } else {
        url::form_urlencoded::parse(format!("x={}", data.replace('+', "%2B")).as_bytes())
            .next()
            .map(|(_, v)| v.into_owned().into_bytes())
            .unwrap_or_default()
    };
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(CoreError::Invalid(
            "the image is too large (over 25 MB)".into(),
        ));
    }
    let filename = format!("image.{}", extension_for(&mime));
    Ok(EmailImage {
        bytes,
        mime,
        filename,
    })
}

/// The file extension for an image type.
fn extension_for(mime: &str) -> &str {
    match mime {
        "image/jpeg" | "image/jpg" | "image/pjpeg" => "jpg",
        "image/svg+xml" => "svg",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        other => {
            let sub = other.strip_prefix("image/").unwrap_or("png");
            if !sub.is_empty() && sub.chars().all(|c| c.is_ascii_alphanumeric()) {
                sub
            } else {
                "png"
            }
        }
    }
}

/// The last part of the image's address ("logo.png"), with an extension
/// added if it has none; "image.png" if the address has no name at all.
fn filename_for(url: &url::Url, mime: &str) -> String {
    let ext = extension_for(mime);
    let last = url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .map(|s| {
            url::form_urlencoded::parse(format!("x={}", s.replace('+', "%2B")).as_bytes())
                .next()
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default()
        })
        .unwrap_or_default();
    let last = last.trim();
    if last.is_empty() {
        return format!("image.{ext}");
    }
    let has_ext = last
        .rsplit_once('.')
        .is_some_and(|(stem, e)| !stem.is_empty() && (1..=5).contains(&e.len()));
    if has_ext {
        last.to_string()
    } else {
        format!("{last}.{ext}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_urls_decode() {
        let img = from_data_url("data:image/png;base64,iVBO Rw==").unwrap();
        assert_eq!(img.bytes, [0x89, b'P', b'N', b'G']);
        assert_eq!(img.mime, "image/png");
        assert_eq!(img.filename, "image.png");

        let svg = from_data_url("data:image/svg+xml,%3Csvg%3E+%3C/svg%3E").unwrap();
        assert_eq!(svg.bytes, b"<svg>+</svg>");
        assert_eq!(svg.filename, "image.svg");
    }

    #[test]
    fn only_images_are_accepted() {
        for bad in [
            "data:text/html;base64,PGI+",
            "data:image/png;base64,***",
            "data:image/png",
        ] {
            assert!(from_data_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn file_names_come_from_the_address() {
        let name = |u: &str, mime: &str| filename_for(&url::Url::parse(u).unwrap(), mime);
        assert_eq!(
            name("https://x.com/a/logo.png?v=2", "image/png"),
            "logo.png"
        );
        assert_eq!(
            name("https://x.com/a/My%20Photo.JPG", "image/jpeg"),
            "My Photo.JPG"
        );
        assert_eq!(
            name("https://x.com/track/abc123", "image/gif"),
            "abc123.gif"
        );
        assert_eq!(name("https://x.com/", "image/jpeg"), "image.jpg");
        assert_eq!(name("https://x.com/img", "image/svg+xml"), "img.svg");
        assert_eq!(name("https://x.com/p", "image/weird;x"), "p.png");
    }

    #[tokio::test]
    async fn web_images_are_fetched_and_others_refused() {
        use wiremock::matchers::path;
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(path("/logo"))
            .respond_with(ResponseTemplate::new(200).set_body_raw(vec![1, 2, 3], "image/gif"))
            .mount(&server)
            .await;
        Mock::given(path("/page"))
            .respond_with(ResponseTemplate::new(200).set_body_raw("<b>", "text/html"))
            .mount(&server)
            .await;
        let http = reqwest::Client::new();

        let img = load(&http, &format!("{}/logo", server.uri()))
            .await
            .unwrap();
        assert_eq!(img.bytes, [1, 2, 3]);
        assert_eq!(img.filename, "logo.gif");

        assert!(load(&http, &format!("{}/page", server.uri()))
            .await
            .is_err());
        assert!(load(&http, &format!("{}/missing", server.uri()))
            .await
            .is_err());
        assert!(load(&http, "file:///etc/hosts").await.is_err());
    }
}
