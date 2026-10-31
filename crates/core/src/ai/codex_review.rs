//! What an agent last reviewed of Codex (`codex_review.json`): the
//! switches that stay on even when turned off, and the tools Codex's
//! request carries with every switch off. Codex can't promise no tools,
//! so the app turns every switch off and pauses ChatGPT when one it
//! hasn't seen stays on; the tool list is rechecked monthly by an agent
//! (`bun run check` says when; see AGENTS.md → Codex review).

use serde::Deserialize;

/// The reviewed list, as committed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Review {
    /// When it was last reviewed (YYYY-MM-DD).
    pub reviewed: String,
    /// The Codex version reviewed. For people only: the app never
    /// compares versions.
    pub codex: String,
    /// Switches that stay on after `-c features.<name>=false`.
    pub stays_on: Vec<String>,
    /// The tools in Codex's request with every switch off.
    pub tools: Vec<String>,
}

/// The committed review.
pub fn review() -> Review {
    serde_json::from_str(include_str!("codex_review.json"))
        .expect("codex_review.json is checked by its test")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_review_reads_and_has_a_date() {
        let r = review();
        assert!(
            chrono::NaiveDate::parse_from_str(&r.reviewed, "%Y-%m-%d").is_ok(),
            "reviewed: {}",
            r.reviewed
        );
        assert!(r.stays_on.contains(&"unified_exec".to_string()));
    }
}
