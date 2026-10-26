//! Rules: Gmail's filters (`settings.filters`). Gmail runs them on its
//! servers as mail arrives, so they work whether or not Mailboat is open.
//! Mailboat shows them in a simpler shape (`Rule`, close to Gmail's own
//! filter form) and saves them with the owning account's sign-in.
//!
//! Gmail can't change a filter in place, so editing one creates the new
//! version, then deletes the old. Whatever Mailboat can't show or edit
//! (forwarding, which needs a more sensitive permission; "exclude chats";
//! labels Mailboat doesn't know) is kept as it was.

use std::collections::HashMap;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::{accounts, Db};
use crate::error::{CoreError, Result};
use crate::gmail::types::{Filter, FilterAction, FilterCriteria};
use crate::gmail::GmailClient;
use crate::model::{AccountId, LabelId, Permission};
use crate::sync::refresh_labels;

/// Which mail a rule is for. Every filled-in part must match.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RuleCriteria {
    pub from: String,
    pub to: String,
    pub subject: String,
    /// Any Gmail search ("Has the words").
    pub has_words: String,
    pub doesnt_have: String,
    pub has_attachment: bool,
    pub size: Option<SizeLimit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SizeLimit {
    pub comparison: SizeComparison,
    pub bytes: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SizeComparison {
    Larger,
    Smaller,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Importance {
    #[default]
    Leave,
    Always,
    Never,
}

/// Gmail's inbox tabs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Primary,
    Social,
    Updates,
    Forums,
    Promotions,
}

impl Category {
    const ALL: [Category; 5] = [
        Category::Primary,
        Category::Social,
        Category::Updates,
        Category::Forums,
        Category::Promotions,
    ];

    fn gmail_id(self) -> &'static str {
        match self {
            Category::Primary => "CATEGORY_PERSONAL",
            Category::Social => "CATEGORY_SOCIAL",
            Category::Updates => "CATEGORY_UPDATES",
            Category::Forums => "CATEGORY_FORUMS",
            Category::Promotions => "CATEGORY_PROMOTIONS",
        }
    }
}

/// What a rule does to matching mail (Gmail's filter actions).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RuleActions {
    /// Archive it.
    pub skip_inbox: bool,
    pub mark_read: bool,
    pub star: bool,
    /// User labels of the rule's account.
    pub labels: Vec<LabelId>,
    pub never_spam: bool,
    /// Move it to the Trash.
    pub trash: bool,
    pub importance: Importance,
    pub category: Option<Category>,
    /// Forwarding set up in Gmail: shown, and kept when the rule is edited,
    /// but not changed here (it needs another permission). Ignored when
    /// saving.
    pub forward_to: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub account_id: AccountId,
    /// Gmail's filter ID, unique only within its account.
    pub filter_id: String,
    pub criteria: RuleCriteria,
    pub actions: RuleActions,
}

/// One account's rules, or why they can't be shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RulesState {
    Ready {
        rules: Vec<Rule>,
    },
    /// The account signed in before Mailboat asked for Gmail's settings.
    NeedsSignIn,
    Unavailable {
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountRules {
    pub account_id: AccountId,
    pub state: RulesState,
}

/// How many conversations a rule's criteria match now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MatchCount {
    pub conversations: u32,
    /// More than `conversations` match (only the first page is counted).
    pub more: bool,
}

/// What applying a rule to mail already received changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub messages: u32,
    /// Stopped at `APPLY_MAX`; older matching mail was left alone.
    pub capped: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedRule {
    pub rule: Rule,
    /// Set when it was also applied to existing mail.
    pub applied: Option<Applied>,
    /// The rule saved, but applying it to existing mail failed.
    pub apply_error: Option<String>,
}

/// The most messages "apply to existing mail" changes (newest first): 20
/// `messages.list` pages and 10 batch changes, about 600 quota units.
pub const APPLY_MAX: usize = 10_000;

/// Conversations counted for the "matches" hint (one `threads.list` page).
const COUNT_PAGE: u32 = 500;

/// System labels a rule's actions can add or remove, other than
/// categories. Anything else is kept untouched on edit.
const SHOWN_ADDS: [&str; 3] = ["STARRED", "TRASH", "IMPORTANT"];
const SHOWN_REMOVES: [&str; 4] = ["INBOX", "UNREAD", "SPAM", "IMPORTANT"];

/// An account's user labels, both ways.
#[derive(Debug, Default)]
struct LabelMap {
    by_gmail: HashMap<String, LabelId>,
    by_id: HashMap<LabelId, String>,
}

fn user_labels(conn: &Connection, account: AccountId) -> Result<LabelMap> {
    let mut stmt = conn
        .prepare("SELECT id, gmail_label_id FROM labels WHERE account_id = ?1 AND kind = 'user'")?;
    let rows: Vec<(LabelId, String)> = stmt
        .query_map([account], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut map = LabelMap::default();
    for (id, gmail) in rows {
        map.by_gmail.insert(gmail.clone(), id);
        map.by_id.insert(id, gmail);
    }
    Ok(map)
}

fn text(s: &Option<String>) -> String {
    s.as_deref().unwrap_or_default().trim().to_string()
}

fn some_text(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn criteria_from_gmail(c: &FilterCriteria) -> RuleCriteria {
    let size = match (c.size, c.size_comparison.as_deref()) {
        (Some(bytes), Some("larger")) => Some(SizeLimit {
            comparison: SizeComparison::Larger,
            bytes,
        }),
        (Some(bytes), Some("smaller")) => Some(SizeLimit {
            comparison: SizeComparison::Smaller,
            bytes,
        }),
        _ => None,
    };
    RuleCriteria {
        from: text(&c.from),
        to: text(&c.to),
        subject: text(&c.subject),
        has_words: text(&c.query),
        doesnt_have: text(&c.negated_query),
        has_attachment: c.has_attachment.unwrap_or(false),
        size,
    }
}

/// A Gmail filter as a rule. The flag says it adds a label Mailboat doesn't
/// know yet (created since labels last synced).
fn from_gmail(account: AccountId, filter: &Filter, labels: &LabelMap) -> (Rule, bool) {
    let add = &filter.action.add_label_ids;
    let remove = &filter.action.remove_label_ids;
    let adds = |id: &str| add.iter().any(|a| a == id);
    let removes = |id: &str| remove.iter().any(|r| r == id);
    let mut unknown = false;
    let mut rule_labels = Vec::new();
    for id in add {
        if let Some(label) = labels.by_gmail.get(id) {
            rule_labels.push(*label);
        } else if !SHOWN_ADDS.contains(&id.as_str())
            && !Category::ALL.iter().any(|c| c.gmail_id() == id)
        {
            unknown = true;
        }
    }
    let actions = RuleActions {
        skip_inbox: removes("INBOX"),
        mark_read: removes("UNREAD"),
        star: adds("STARRED"),
        labels: rule_labels,
        never_spam: removes("SPAM"),
        trash: adds("TRASH"),
        importance: if adds("IMPORTANT") {
            Importance::Always
        } else if removes("IMPORTANT") {
            Importance::Never
        } else {
            Importance::Leave
        },
        category: Category::ALL.into_iter().find(|c| adds(c.gmail_id())),
        forward_to: filter.action.forward.as_deref().and_then(some_text),
    };
    let rule = Rule {
        account_id: account,
        filter_id: filter.id.clone().unwrap_or_default(),
        criteria: criteria_from_gmail(&filter.criteria),
        actions,
    };
    (rule, unknown)
}

fn criteria_to_gmail(c: &RuleCriteria) -> Result<FilterCriteria> {
    if c.size.is_some_and(|s| s.bytes == 0) {
        return Err(CoreError::Invalid(
            "A size needs to be more than zero.".into(),
        ));
    }
    Ok(FilterCriteria {
        from: some_text(&c.from),
        to: some_text(&c.to),
        subject: some_text(&c.subject),
        query: some_text(&c.has_words),
        negated_query: some_text(&c.doesnt_have),
        has_attachment: c.has_attachment.then_some(true),
        exclude_chats: None,
        size: c.size.map(|s| s.bytes),
        size_comparison: c.size.map(|s| {
            match s.comparison {
                SizeComparison::Larger => "larger",
                SizeComparison::Smaller => "smaller",
            }
            .to_string()
        }),
    })
}

fn has_criteria(c: &FilterCriteria) -> bool {
    c.from.is_some()
        || c.to.is_some()
        || c.subject.is_some()
        || c.query.is_some()
        || c.negated_query.is_some()
        || c.has_attachment == Some(true)
        || c.size.is_some()
}

/// A rule as a Gmail filter. `kept` is the filter being edited: what Mailboat
/// doesn't show (forwarding, unknown labels, "exclude chats") carries over.
fn to_gmail(
    criteria: &RuleCriteria,
    actions: &RuleActions,
    labels: &LabelMap,
    kept: Option<&Filter>,
) -> Result<Filter> {
    let mut criteria = criteria_to_gmail(criteria)?;
    if !has_criteria(&criteria) {
        return Err(CoreError::Invalid(
            "Say which mail the rule is for: fill in From, To, Subject, the words, or a size."
                .into(),
        ));
    }
    let mut add: Vec<String> = Vec::new();
    let mut remove: Vec<String> = Vec::new();
    let flag = |on: bool, list: &mut Vec<String>, id: &str| {
        if on {
            list.push(id.to_string());
        }
    };
    flag(actions.skip_inbox, &mut remove, "INBOX");
    flag(actions.mark_read, &mut remove, "UNREAD");
    flag(actions.star, &mut add, "STARRED");
    flag(actions.never_spam, &mut remove, "SPAM");
    flag(actions.trash, &mut add, "TRASH");
    flag(
        actions.importance == Importance::Always,
        &mut add,
        "IMPORTANT",
    );
    flag(
        actions.importance == Importance::Never,
        &mut remove,
        "IMPORTANT",
    );
    if let Some(category) = actions.category {
        add.push(category.gmail_id().to_string());
    }
    for label in &actions.labels {
        let gmail = labels
            .by_id
            .get(label)
            .ok_or_else(|| CoreError::Invalid("A label the rule uses no longer exists.".into()))?;
        add.push(gmail.clone());
    }
    let mut forward = None;
    if let Some(old) = kept {
        add.extend(
            old.action
                .add_label_ids
                .iter()
                .filter(|id| {
                    !SHOWN_ADDS.contains(&id.as_str())
                        && !Category::ALL.iter().any(|c| c.gmail_id() == *id)
                        && !labels.by_gmail.contains_key(*id)
                })
                .cloned(),
        );
        remove.extend(
            old.action
                .remove_label_ids
                .iter()
                .filter(|id| !SHOWN_REMOVES.contains(&id.as_str()))
                .cloned(),
        );
        forward = old.action.forward.clone();
        criteria.exclude_chats = old.criteria.exclude_chats.filter(|&on| on);
    }
    if add.is_empty() && remove.is_empty() && forward.is_none() {
        return Err(CoreError::Invalid(
            "Choose at least one thing the rule does.".into(),
        ));
    }
    Ok(normalized(&Filter {
        id: None,
        criteria,
        action: FilterAction {
            add_label_ids: add,
            remove_label_ids: remove,
            forward,
        },
    }))
}

/// A filter without its ID, blanks or defaults, labels sorted: two
/// filters that do the same compare equal.
fn normalized(f: &Filter) -> Filter {
    let trim = |s: &Option<String>| s.as_deref().and_then(some_text);
    let mut add = f.action.add_label_ids.clone();
    add.sort();
    add.dedup();
    let mut remove = f.action.remove_label_ids.clone();
    remove.sort();
    remove.dedup();
    let sized = f.criteria.size.is_some()
        && matches!(
            f.criteria.size_comparison.as_deref(),
            Some("larger" | "smaller")
        );
    Filter {
        id: None,
        criteria: FilterCriteria {
            from: trim(&f.criteria.from),
            to: trim(&f.criteria.to),
            subject: trim(&f.criteria.subject),
            query: trim(&f.criteria.query),
            negated_query: trim(&f.criteria.negated_query),
            has_attachment: f.criteria.has_attachment.filter(|&on| on),
            exclude_chats: f.criteria.exclude_chats.filter(|&on| on),
            size: f.criteria.size.filter(|_| sized),
            size_comparison: f.criteria.size_comparison.clone().filter(|_| sized),
        },
        action: FilterAction {
            add_label_ids: add,
            remove_label_ids: remove,
            forward: trim(&f.action.forward),
        },
    }
}

/// The Gmail search a filter's criteria amount to, as Gmail's own filter
/// form writes it.
pub fn search_query(c: &FilterCriteria) -> String {
    let mut parts = Vec::new();
    let field = |name: &str, value: &Option<String>| {
        value
            .as_deref()
            .and_then(some_text)
            .map(|v| format!("{name}:({v})"))
    };
    parts.extend(field("from", &c.from));
    parts.extend(field("to", &c.to));
    parts.extend(field("subject", &c.subject));
    if let Some(words) = c.query.as_deref().and_then(some_text) {
        parts.push(words);
    }
    if let Some(words) = c.negated_query.as_deref().and_then(some_text) {
        parts.push(format!("-{{{words}}}"));
    }
    if c.has_attachment == Some(true) {
        parts.push("has:attachment".into());
    }
    match (c.size, c.size_comparison.as_deref()) {
        (Some(bytes), Some("larger")) => parts.push(format!("larger:{bytes}")),
        (Some(bytes), Some("smaller")) => parts.push(format!("smaller:{bytes}")),
        _ => {}
    }
    parts.join(" ")
}

/// Gmail's refusals, in words.
fn friendly(e: CoreError) -> CoreError {
    match e {
        e if e.is_missing_scope() => CoreError::Invalid(
            "Sign in to this account again (Settings → Accounts) so Mailboat can change its rules."
                .into(),
        ),
        CoreError::Api {
            status: 400,
            message,
        } if message.to_lowercase().contains("exists") => {
            CoreError::Invalid("This account already has a rule just like this one.".into())
        }
        e => e,
    }
}

/// An account's rules, in Gmail's order. Problems are part of the answer,
/// so one account's trouble doesn't hide another's rules.
pub async fn list(db: &Db, gmail: &GmailClient, account: AccountId) -> Result<AccountRules> {
    let missing = accounts::get(&db.conn(), account)?.missing_permissions;
    let state = if missing.contains(&Permission::GmailSettings) {
        RulesState::NeedsSignIn
    } else {
        match gmail.filters().await {
            Ok(list) => RulesState::Ready {
                rules: rules_from(db, gmail, account, &list.filter).await?,
            },
            Err(e) if e.is_missing_scope() => RulesState::NeedsSignIn,
            Err(CoreError::Network(_)) => RulesState::Unavailable {
                message: "Couldn’t reach Gmail.".into(),
            },
            Err(e) => RulesState::Unavailable {
                message: e.to_string(),
            },
        }
    };
    Ok(AccountRules {
        account_id: account,
        state,
    })
}

/// Converts filters, refreshing labels once if one is new to Mailboat.
async fn rules_from(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    filters: &[Filter],
) -> Result<Vec<Rule>> {
    let convert = |labels: &LabelMap| {
        let mut unknown = false;
        let rules: Vec<Rule> = filters
            .iter()
            .filter(|f| f.id.is_some())
            .map(|f| {
                let (rule, new_label) = from_gmail(account, f, labels);
                unknown |= new_label;
                rule
            })
            .collect();
        (rules, unknown)
    };
    let labels = user_labels(&db.conn(), account)?;
    let (rules, unknown) = convert(&labels);
    if !unknown || refresh_labels(db, gmail, account).await.is_err() {
        return Ok(rules);
    }
    let labels = user_labels(&db.conn(), account)?;
    Ok(convert(&labels).0)
}

/// Creates a rule, and applies it to mail already received if asked.
pub async fn create(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    criteria: &RuleCriteria,
    actions: &RuleActions,
    apply_to_existing: bool,
) -> Result<SavedRule> {
    let labels = user_labels(&db.conn(), account)?;
    let filter = to_gmail(criteria, actions, &labels, None)?;
    let made = gmail.create_filter(&filter).await.map_err(friendly)?;
    Ok(saved(gmail, account, made, &labels, apply_to_existing).await)
}

/// Replaces a rule with an edited version. Unchanged rules stay as they
/// are (Gmail would refuse a duplicate).
pub async fn update(
    db: &Db,
    gmail: &GmailClient,
    account: AccountId,
    filter_id: &str,
    criteria: &RuleCriteria,
    actions: &RuleActions,
    apply_to_existing: bool,
) -> Result<SavedRule> {
    let old = gmail
        .filter(filter_id)
        .await
        .map_err(friendly)?
        .ok_or_else(|| CoreError::NotFound("This rule was deleted (in Gmail, perhaps).".into()))?;
    let labels = user_labels(&db.conn(), account)?;
    let filter = to_gmail(criteria, actions, &labels, Some(&old))?;
    if filter == normalized(&old) {
        return Ok(saved(gmail, account, old, &labels, apply_to_existing).await);
    }
    let made = gmail.create_filter(&filter).await.map_err(friendly)?;
    if let Err(e) = gmail.delete_filter(filter_id).await {
        // Don't leave both: put things back as they were.
        if let Some(id) = &made.id {
            let _ = gmail.delete_filter(id).await;
        }
        return Err(friendly(e));
    }
    Ok(saved(gmail, account, made, &labels, apply_to_existing).await)
}

async fn saved(
    gmail: &GmailClient,
    account: AccountId,
    filter: Filter,
    labels: &LabelMap,
    apply_to_existing: bool,
) -> SavedRule {
    let (applied, apply_error) = if apply_to_existing {
        match apply(gmail, &filter).await {
            Ok(applied) => (Some(applied), None),
            Err(e) => (None, Some(friendly(e).to_string())),
        }
    } else {
        (None, None)
    };
    SavedRule {
        rule: from_gmail(account, &filter, labels).0,
        applied,
        apply_error,
    }
}

/// Deletes a rule. Mail it already sorted stays as it is (as in Gmail).
pub async fn delete(gmail: &GmailClient, filter_id: &str) -> Result<()> {
    gmail.delete_filter(filter_id).await.map_err(friendly)
}

/// How many conversations the criteria match now (outside Spam and
/// Trash), or `None` if nothing is filled in yet.
pub async fn match_count(
    gmail: &GmailClient,
    criteria: &RuleCriteria,
) -> Result<Option<MatchCount>> {
    let criteria = criteria_to_gmail(criteria)?;
    if !has_criteria(&criteria) {
        return Ok(None);
    }
    let q = search_query(&criteria);
    let page = gmail
        .search_threads(None, Some(&q), false, None, COUNT_PAGE)
        .await
        .map_err(friendly)?;
    Ok(Some(MatchCount {
        conversations: page.threads.len() as u32,
        more: page.next_page_token.is_some(),
    }))
}

/// Does what a filter does to the matching messages already received
/// (newest first, up to `APPLY_MAX`), as Gmail's "Also apply filter to
/// matching conversations". Forwarding isn't repeated for old mail.
pub async fn apply(gmail: &GmailClient, filter: &Filter) -> Result<Applied> {
    let add = &filter.action.add_label_ids;
    let remove = &filter.action.remove_label_ids;
    if add.is_empty() && remove.is_empty() {
        return Ok(Applied {
            messages: 0,
            capped: false,
        });
    }
    let q = search_query(&filter.criteria);
    let mut ids: Vec<String> = Vec::new();
    let mut page_token: Option<String> = None;
    let capped = loop {
        let page = gmail
            .search_message_ids(&q, page_token.as_deref(), 500)
            .await?;
        ids.extend(page.messages.into_iter().map(|m| m.id));
        if ids.len() >= APPLY_MAX {
            let more = ids.len() > APPLY_MAX || page.next_page_token.is_some();
            ids.truncate(APPLY_MAX);
            break more;
        }
        match page.next_page_token {
            Some(token) => page_token = Some(token),
            None => break false,
        }
    };
    for chunk in ids.chunks(1000) {
        gmail.batch_modify_messages(chunk, add, remove).await?;
    }
    Ok(Applied {
        messages: ids.len() as u32,
        capped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels() -> LabelMap {
        let mut map = LabelMap::default();
        for (id, gmail) in [(LabelId(7), "Label_7"), (LabelId(8), "Label_8")] {
            map.by_gmail.insert(gmail.into(), id);
            map.by_id.insert(id, gmail.into());
        }
        map
    }

    fn from(addr: &str) -> RuleCriteria {
        RuleCriteria {
            from: addr.into(),
            ..Default::default()
        }
    }

    #[test]
    fn actions_become_gmail_label_changes() {
        let actions = RuleActions {
            skip_inbox: true,
            mark_read: true,
            star: true,
            labels: vec![LabelId(8)],
            never_spam: true,
            trash: false,
            importance: Importance::Never,
            category: Some(Category::Updates),
            forward_to: Some("ignored@x.com".into()),
        };
        let f = to_gmail(&from(" news@x.com "), &actions, &labels(), None).unwrap();
        assert_eq!(f.criteria.from.as_deref(), Some("news@x.com"));
        assert_eq!(f.criteria.to, None);
        assert_eq!(
            f.action.add_label_ids,
            ["CATEGORY_UPDATES", "Label_8", "STARRED"]
        );
        assert_eq!(
            f.action.remove_label_ids,
            ["IMPORTANT", "INBOX", "SPAM", "UNREAD"]
        );
        // Forwarding can't be set from Mailboat.
        assert_eq!(f.action.forward, None);
    }

    #[test]
    fn a_filter_round_trips_through_a_rule() {
        let filter = Filter {
            id: Some("f1".into()),
            criteria: FilterCriteria {
                subject: Some("Invoice".into()),
                has_attachment: Some(true),
                size: Some(1_000_000),
                size_comparison: Some("larger".into()),
                ..Default::default()
            },
            action: FilterAction {
                add_label_ids: vec!["Label_7".into(), "TRASH".into(), "IMPORTANT".into()],
                remove_label_ids: vec![],
                forward: None,
            },
        };
        let (rule, unknown) = from_gmail(AccountId(1), &filter, &labels());
        assert!(!unknown);
        assert_eq!(rule.filter_id, "f1");
        assert_eq!(rule.criteria.subject, "Invoice");
        assert!(rule.criteria.has_attachment);
        assert_eq!(
            rule.criteria.size,
            Some(SizeLimit {
                comparison: SizeComparison::Larger,
                bytes: 1_000_000
            })
        );
        assert_eq!(rule.actions.labels, [LabelId(7)]);
        assert!(rule.actions.trash);
        assert_eq!(rule.actions.importance, Importance::Always);
        let back = to_gmail(&rule.criteria, &rule.actions, &labels(), Some(&filter)).unwrap();
        assert_eq!(back, normalized(&filter));
    }

    #[test]
    fn editing_keeps_what_the_app_cannot_show() {
        let old = Filter {
            id: Some("f1".into()),
            criteria: FilterCriteria {
                from: Some("a@x.com".into()),
                exclude_chats: Some(true),
                ..Default::default()
            },
            action: FilterAction {
                add_label_ids: vec!["Label_7".into(), "Label_99".into()],
                remove_label_ids: vec!["INBOX".into()],
                forward: Some("me@elsewhere.com".into()),
            },
        };
        let (rule, unknown) = from_gmail(AccountId(1), &old, &labels());
        // Label_99 isn't known locally: flagged so labels refresh.
        assert!(unknown);
        assert_eq!(rule.actions.forward_to.as_deref(), Some("me@elsewhere.com"));
        // The owner swaps the label and stops archiving.
        let actions = RuleActions {
            labels: vec![LabelId(8)],
            skip_inbox: false,
            ..rule.actions.clone()
        };
        let f = to_gmail(&rule.criteria, &actions, &labels(), Some(&old)).unwrap();
        assert_eq!(f.action.add_label_ids, ["Label_8", "Label_99"]);
        assert!(f.action.remove_label_ids.is_empty());
        assert_eq!(f.action.forward.as_deref(), Some("me@elsewhere.com"));
        assert_eq!(f.criteria.exclude_chats, Some(true));
    }

    #[test]
    fn a_rule_needs_criteria_and_an_action() {
        let star = RuleActions {
            star: true,
            ..Default::default()
        };
        let blank = RuleCriteria {
            from: "  ".into(),
            ..Default::default()
        };
        assert!(matches!(
            to_gmail(&blank, &star, &labels(), None),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            to_gmail(&from("a@x.com"), &RuleActions::default(), &labels(), None),
            Err(CoreError::Invalid(_))
        ));
        let gone = RuleActions {
            labels: vec![LabelId(404)],
            ..Default::default()
        };
        assert!(matches!(
            to_gmail(&from("a@x.com"), &gone, &labels(), None),
            Err(CoreError::Invalid(_))
        ));
        let zero = RuleCriteria {
            size: Some(SizeLimit {
                comparison: SizeComparison::Smaller,
                bytes: 0,
            }),
            ..Default::default()
        };
        assert!(matches!(
            to_gmail(&zero, &star, &labels(), None),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn search_query_reads_like_gmails() {
        let c = FilterCriteria {
            from: Some("a@x.com OR b@x.com".into()),
            subject: Some("weekly report".into()),
            query: Some("unsubscribe".into()),
            negated_query: Some("urgent".into()),
            has_attachment: Some(true),
            size: Some(2048),
            size_comparison: Some("smaller".into()),
            ..Default::default()
        };
        assert_eq!(
            search_query(&c),
            "from:(a@x.com OR b@x.com) subject:(weekly report) unsubscribe -{urgent} has:attachment smaller:2048"
        );
    }

    #[test]
    fn normalizing_ignores_blanks_and_order() {
        let a = Filter {
            id: Some("x".into()),
            criteria: FilterCriteria {
                from: Some("a@x.com".into()),
                to: Some("".into()),
                has_attachment: Some(false),
                size_comparison: Some("unspecified".into()),
                ..Default::default()
            },
            action: FilterAction {
                add_label_ids: vec!["STARRED".into(), "Label_7".into()],
                ..Default::default()
            },
        };
        let b = Filter {
            id: None,
            criteria: FilterCriteria {
                from: Some(" a@x.com".into()),
                ..Default::default()
            },
            action: FilterAction {
                add_label_ids: vec!["Label_7".into(), "STARRED".into()],
                ..Default::default()
            },
        };
        assert_eq!(normalized(&a), normalized(&b));
    }
}
