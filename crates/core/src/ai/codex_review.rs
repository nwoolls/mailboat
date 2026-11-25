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
//! tools. Each records what it showed, and the lists the app checks
//! against are what every reviewed system showed together (a test keeps
//! them so), so the systems can be compared.

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
    /// The switches still on there after being turned off.
    pub stays_on: Vec<String>,
    /// The tools in Codex's request there with every switch off.
    pub tools: Vec<String>,
}

/// The reviewed list, as committed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Review {
    /// Each system reviewed so far; one not listed was never reviewed.
    pub platforms: BTreeMap<String, PlatformReview>,
    /// Switches that stay on after `-c features.<name>=false`, on any
    /// reviewed system.
    pub stays_on: Vec<String>,
    /// The tools in Codex's request with every switch off, on any
    /// reviewed system.
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

/// Where two systems' lists differ, by system: what to look at before
/// running only the live tests on one of them. A system with no record
/// is named too, so a missing review never reads as matching ones.
pub fn differences(r: &Review) -> Vec<String> {
    let mut out: Vec<String> = PLATFORMS
        .iter()
        .filter(|p| !r.platforms.contains_key(**p))
        .map(|p| format!("{p}: not reviewed"))
        .collect();
    let first = r.platforms.iter().next();
    for (name, p) in &r.platforms {
        if let Some((base, b)) = first {
            for (what, mine, theirs) in [
                ("switch", &p.stays_on, &b.stays_on),
                ("tool", &p.tools, &b.tools),
            ] {
                for item in mine.iter().filter(|i| !theirs.contains(i)) {
                    out.push(format!("{what} {item}: on {name}, not on {base}"));
                }
                for item in theirs.iter().filter(|i| !mine.contains(i)) {
                    out.push(format!("{what} {item}: on {base}, not on {name}"));
                }
            }
        }
    }
    out
}

/// How this system's observation compares with its own record: None when
/// it matches, or it has no record yet (the review then records it); else
/// what changed. `pick` chooses the list (`stays_on` or `tools`).
pub fn against_this_system(
    observed: &[String],
    pick: fn(&PlatformReview) -> &Vec<String>,
) -> Option<String> {
    against(&review(), std::env::consts::OS, observed, pick)
}

/// `against_this_system` for any review and system, so it can be tested.
fn against(
    review: &Review,
    system: &str,
    observed: &[String],
    pick: fn(&PlatformReview) -> &Vec<String>,
) -> Option<String> {
    let recorded = pick(review.platforms.get(system)?);
    let added: Vec<_> = observed.iter().filter(|i| !recorded.contains(i)).collect();
    let gone: Vec<_> = recorded.iter().filter(|i| !observed.contains(i)).collect();
    (!added.is_empty() || !gone.is_empty())
        .then(|| format!("{system}'s record differs: new {added:?}, gone {gone:?}"))
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

    /// The lists the app checks against are exactly what the reviewed
    /// systems showed together: nothing one showed is missing, and nothing
    /// is listed that none showed.
    #[test]
    fn the_shared_lists_are_what_the_systems_showed() {
        let r = review();
        let union = |pick: fn(&PlatformReview) -> &Vec<String>| {
            let mut all: Vec<String> = r.platforms.values().flat_map(pick).cloned().collect();
            all.sort();
            all.dedup();
            all
        };
        let sorted = |list: &[String]| {
            let mut list = list.to_vec();
            list.sort();
            list
        };
        assert_eq!(sorted(&r.stays_on), union(|p| &p.stays_on));
        assert_eq!(sorted(&r.tools), union(|p| &p.tools));
    }

    #[test]
    fn differences_between_systems_are_named() {
        let system = |tools: &[&str]| PlatformReview {
            reviewed: "2026-11-24".into(),
            codex: "0.0.0".into(),
            stays_on: vec!["unified_exec".into()],
            tools: tools.iter().map(|t| t.to_string()).collect(),
        };
        let r = Review {
            platforms: [
                (
                    "macos".to_string(),
                    system(&["functions.exec", "functions.wait"]),
                ),
                ("windows".to_string(), system(&["functions.wait"])),
            ]
            .into(),
            stays_on: vec!["unified_exec".into()],
            tools: vec!["functions.exec".into(), "functions.wait".into()],
            refused_models: vec![],
        };
        assert_eq!(
            differences(&r),
            [
                "linux: not reviewed",
                "tool functions.exec: on macos, not on windows"
            ]
        );
    }

    /// Review (round 1 of this branch): the comparison the review tests
    /// assert on, run in the regular suite.
    #[test]
    fn an_observation_is_compared_with_its_own_systems_record() {
        let entry = |tools: &[&str]| PlatformReview {
            reviewed: "2026-11-25".into(),
            codex: "0.0.0".into(),
            stays_on: vec![],
            tools: tools.iter().map(|t| t.to_string()).collect(),
        };
        let r = Review {
            platforms: [
                ("macos".to_string(), entry(&["a", "b"])),
                ("windows".to_string(), entry(&[])),
            ]
            .into(),
            stays_on: vec![],
            tools: vec!["a".into(), "b".into()],
            refused_models: vec![],
        };
        let seen = |items: &[&str]| items.iter().map(|i| i.to_string()).collect::<Vec<_>>();
        let tools: fn(&PlatformReview) -> &Vec<String> = |p| &p.tools;
        assert_eq!(
            against(&r, "macos", &seen(&["b", "a"]), tools),
            None,
            "order"
        );
        assert_eq!(
            against(&r, "macos", &seen(&["a", "b", "c"]), tools).as_deref(),
            Some(r#"macos's record differs: new ["c"], gone []"#)
        );
        assert_eq!(
            against(&r, "macos", &seen(&["a"]), tools).as_deref(),
            Some(r#"macos's record differs: new [], gone ["b"]"#)
        );
        assert_eq!(against(&r, "windows", &seen(&[]), tools), None, "empty");
        assert_eq!(
            against(&r, "windows", &seen(&["a"]), tools).as_deref(),
            Some(r#"windows's record differs: new ["a"], gone []"#)
        );
        // No record yet: the review records it, so nothing to compare.
        assert_eq!(against(&r, "plan9", &seen(&["a"]), tools), None);
    }

    /// Review (round 1 of this branch): a system with no review is named,
    /// so it never reads as one that matches.
    #[test]
    fn a_system_with_no_review_is_named_among_the_differences() {
        let r = Review {
            platforms: [(
                "macos".to_string(),
                PlatformReview {
                    reviewed: "2026-11-25".into(),
                    codex: "0.0.0".into(),
                    stays_on: vec![],
                    tools: vec![],
                },
            )]
            .into(),
            stays_on: vec![],
            tools: vec![],
            refused_models: vec![],
        };
        assert_eq!(
            differences(&r),
            ["windows: not reviewed", "linux: not reviewed"]
        );
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
