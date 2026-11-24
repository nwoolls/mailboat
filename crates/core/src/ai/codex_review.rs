//! What an agent last reviewed of Codex (`codex_review.json`): the
//! switches that stay on even when turned off, and the tools Codex's
//! request carries with every switch off. Codex can't promise no tools,
//! so the app turns every switch off and pauses ChatGPT when one it
//! hasn't seen stays on; the tool list is rechecked monthly by an agent
//! (`bun run check` says when; see AGENTS.md → Codex review).
//!
//! Each system is reviewed on its own (`platforms`, keyed by Rust's
//! `std::env::consts::OS`): the fence that stops Codex differs (macOS's
//! sandbox, bubblewrap on Linux, none on Windows), and so can Codex's own
//! tools. The lists are what every reviewed system showed together.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The systems the app ships for, as `platforms` names them.
pub const PLATFORMS: [&str; 3] = ["macos", "windows", "linux"];

/// One system's last review.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PlatformReview {
    /// When it was last reviewed (YYYY-MM-DD).
    pub reviewed: String,
    /// The Codex version reviewed. For people only: the app never
    /// compares versions.
    pub codex: String,
}

/// The reviewed list, as committed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Review {
    /// Each system reviewed so far; one not listed was never reviewed.
    pub platforms: BTreeMap<String, PlatformReview>,
    /// Switches that stay on after `-c features.<name>=false`.
    pub stays_on: Vec<String>,
    /// The tools in Codex's request with every switch off.
    pub tools: Vec<String>,
    /// Models Codex lists but refuses with a ChatGPT sign-in (the only way
    /// the app uses it), so their tools can't reach a request: the monthly
    /// capture skips them, and a live check confirms they're still refused.
    #[serde(default)]
    pub refused_models: Vec<String>,
}

/// The committed review.
pub fn review() -> Review {
    serde_json::from_str(include_str!("codex_review.json"))
        .expect("codex_review.json is checked by its test")
}

/// Switches still on after being turned off that the review doesn't
/// list: what pauses ChatGPT.
pub fn unreviewed(still_on: &[String]) -> Vec<String> {
    let review = review();
    still_on
        .iter()
        .filter(|s| !review.stays_on.contains(s))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_review_reads_and_each_system_has_a_date() {
        let r = review();
        assert!(
            r.platforms.contains_key("macos"),
            "the Mac is always reviewed"
        );
        for (platform, review) in &r.platforms {
            assert!(
                PLATFORMS.contains(&platform.as_str()),
                "unknown system {platform}"
            );
            assert!(
                jiff::civil::Date::strptime("%Y-%m-%d", &review.reviewed).is_ok(),
                "{platform} reviewed: {}",
                review.reviewed
            );
            assert!(!review.codex.is_empty(), "{platform}: which Codex");
        }
        assert!(r.stays_on.contains(&"unified_exec".to_string()));
    }

    /// The system the app is built for has a name the review can use.
    #[test]
    fn this_system_is_one_the_review_names() {
        assert!(PLATFORMS.contains(&std::env::consts::OS));
    }

    #[test]
    fn only_switches_the_review_doesnt_list_are_unreviewed() {
        let still = vec!["unified_exec".to_string(), "brand_new_tool".to_string()];
        assert_eq!(unreviewed(&still), ["brand_new_tool"]);
    }
}
