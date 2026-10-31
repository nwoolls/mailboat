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
    fn the_review_reads_and_has_a_date() {
        let r = review();
        assert!(
            chrono::NaiveDate::parse_from_str(&r.reviewed, "%Y-%m-%d").is_ok(),
            "reviewed: {}",
            r.reviewed
        );
        assert!(r.stays_on.contains(&"unified_exec".to_string()));
    }

    #[test]
    fn only_switches_the_review_doesnt_list_are_unreviewed() {
        let still = vec!["unified_exec".to_string(), "brand_new_tool".to_string()];
        assert_eq!(unreviewed(&still), ["brand_new_tool"]);
    }
}
