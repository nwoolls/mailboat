//! Google batch requests: many API calls in one `multipart/mixed` HTTP call.
//! Reference: https://developers.google.com/gmail/api/guides/batch

use crate::error::{CoreError, Result};

#[derive(Debug, Clone, PartialEq)]
pub struct BatchPart {
    pub status: u16,
    pub body: String,
}

pub fn build_request(boundary: &str, paths: &[String]) -> String {
    let mut body = String::new();
    for (i, path) in paths.iter().enumerate() {
        body.push_str(&format!(
            "--{boundary}\r\nContent-Type: application/http\r\nContent-ID: <item{i}>\r\n\r\nGET {path}\r\n\r\n"
        ));
    }
    body.push_str(&format!("--{boundary}--\r\n"));
    body
}

/// Splits a batch response into one part per request, ordered by the
/// `Content-ID` we sent. Missing parts are left out, so the caller retries them.
pub fn parse_response(content_type: &str, body: &str, expected: usize) -> Result<Vec<BatchPart>> {
    let boundary = content_type
        .split(';')
        .find_map(|p| {
            let (k, v) = p.split_once('=')?;
            (k.trim().eq_ignore_ascii_case("boundary"))
                .then(|| v.trim().trim_matches('"').to_string())
        })
        .ok_or_else(|| {
            CoreError::Other(format!("batch response without boundary: {content_type}"))
        })?;

    let delimiter = format!("--{boundary}");
    let mut slots: Vec<Option<BatchPart>> = vec![None; expected];
    let mut unordered = Vec::new();
    for raw in body.split(delimiter.as_str()).skip(1) {
        if raw.starts_with("--") {
            break; // closing delimiter
        }
        let raw = raw.replace("\r\n", "\n");
        // Outer part headers, blank line, then the embedded HTTP response.
        let Some((outer_headers, http)) = raw.trim_start_matches('\n').split_once("\n\n") else {
            continue;
        };
        let index = outer_headers.lines().find_map(|line| {
            let (k, v) = line.split_once(':')?;
            if !k.trim().eq_ignore_ascii_case("content-id") {
                return None;
            }
            let digits: String = v
                .trim()
                .trim_start_matches('<')
                .trim_start_matches("response-")
                .trim_start_matches("item")
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            digits.parse::<usize>().ok()
        });
        let http = http.trim_start_matches('\n');
        let status_line = http.lines().next().unwrap_or_default();
        let status: u16 = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let response_body = http
            .split_once("\n\n")
            .map(|(_, b)| b.trim().to_string())
            .unwrap_or_default();
        let part = BatchPart {
            status,
            body: response_body,
        };
        match index {
            Some(i) if i < expected => slots[i] = Some(part),
            _ => unordered.push(part),
        }
    }
    // Fall back to response order for parts without a usable Content-ID.
    let mut unordered = unordered.into_iter();
    Ok(slots
        .into_iter()
        .map(|slot| {
            slot.or_else(|| unordered.next()).unwrap_or(BatchPart {
                status: 0,
                body: String::new(),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_one_part_per_request() {
        let body = build_request("b", &["/a".into(), "/b".into()]);
        assert_eq!(body.matches("--b\r\n").count(), 2);
        assert!(body.contains("Content-ID: <item1>\r\n\r\nGET /b\r\n"));
        assert!(body.ends_with("--b--\r\n"));
    }

    #[test]
    fn parses_out_of_order_parts_and_statuses() {
        let body =
            "--batch_x\r\nContent-Type: application/http\r\nContent-ID: <response-item1>\r\n\r\n\
HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\n\r\n{\"error\":{}}\r\n\
--batch_x\r\nContent-Type: application/http\r\nContent-ID: <response-item0>\r\n\r\n\
HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"id\":\"t0\"}\r\n--batch_x--\r\n";
        let parts = parse_response("multipart/mixed; boundary=batch_x", body, 2).unwrap();
        assert_eq!(
            parts[0],
            BatchPart {
                status: 200,
                body: "{\"id\":\"t0\"}".into()
            }
        );
        assert_eq!(parts[1].status, 429);
    }

    #[test]
    fn missing_parts_come_back_as_status_zero() {
        let parts = parse_response("multipart/mixed; boundary=z", "--z--", 1).unwrap();
        assert_eq!(parts[0].status, 0);
    }
}
