//! Types shared by the database, sync engine and the UI (exported to
//! TypeScript through specta). IDs here are local surrogate IDs, never Gmail
//! IDs, so they are unique across all accounts.

use serde::{Deserialize, Serialize};
use specta::Type;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type,
        )]
        pub struct $name(pub i64);

        impl rusqlite::ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
                self.0.to_sql()
            }
        }

        impl rusqlite::types::FromSql for $name {
            fn column_result(
                v: rusqlite::types::ValueRef<'_>,
            ) -> rusqlite::types::FromSqlResult<Self> {
                i64::column_result(v).map($name)
            }
        }
    };
}

id_type!(AccountId);
id_type!(ThreadId);
id_type!(MessageId);
id_type!(LabelId);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: AccountId,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    /// Hex color used to mark this account's rows in unified views.
    pub color: String,
    /// Which OAuth client config this account signed in with.
    pub oauth_client: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

/// Gmail system labels that unify across accounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SystemLabel {
    Inbox,
    Unread,
    Starred,
    Important,
    Sent,
    Draft,
    Spam,
    Trash,
}

impl SystemLabel {
    pub const ALL: [SystemLabel; 8] = [
        SystemLabel::Inbox,
        SystemLabel::Unread,
        SystemLabel::Starred,
        SystemLabel::Important,
        SystemLabel::Sent,
        SystemLabel::Draft,
        SystemLabel::Spam,
        SystemLabel::Trash,
    ];

    pub fn gmail_id(self) -> &'static str {
        match self {
            SystemLabel::Inbox => "INBOX",
            SystemLabel::Unread => "UNREAD",
            SystemLabel::Starred => "STARRED",
            SystemLabel::Important => "IMPORTANT",
            SystemLabel::Sent => "SENT",
            SystemLabel::Draft => "DRAFT",
            SystemLabel::Spam => "SPAM",
            SystemLabel::Trash => "TRASH",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LabelKind {
    System,
    User,
}

impl LabelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LabelKind::System => "system",
            LabelKind::User => "user",
        }
    }

    pub fn parse(s: &str) -> Self {
        if s == "user" {
            LabelKind::User
        } else {
            LabelKind::System
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: LabelId,
    pub account_id: AccountId,
    pub gmail_label_id: String,
    pub name: String,
    pub kind: LabelKind,
    pub color_bg: Option<String>,
    pub color_fg: Option<String>,
}

/// How many conversations under one label (system or user, in one account)
/// have unread mail. Labels with none are left out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LabelUnread {
    pub label_id: LabelId,
    pub account_id: AccountId,
    /// `INBOX`, `UNREAD`, `DRAFT`, … or a user label's ID.
    pub gmail_label_id: String,
    pub unread: u32,
}

/// Which accounts a query covers. A single-account view is `Only` with one ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "ids", rename_all = "camelCase")]
pub enum AccountFilter {
    All,
    Only(Vec<AccountId>),
}

/// What a list view shows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MailView {
    /// Unifies across accounts (Inbox, Starred, ...).
    System { label: SystemLabel },
    /// A user label belongs to exactly one account.
    #[serde(rename_all = "camelCase")]
    UserLabel { label_id: LabelId },
    /// Every thread except Spam and Trash (unifies across accounts).
    AllMail,
    /// All Mail minus the Inbox. Gmail has no "archived" label: archived
    /// just means not in INBOX.
    Archive,
    /// Local full-text search (Spam and Trash excluded, as in Gmail).
    Search { text: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListCursor {
    pub last_message_at: i64,
    pub thread_id: ThreadId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub accounts: AccountFilter,
    pub view: MailView,
    pub cursor: Option<ListCursor>,
    pub limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: ThreadId,
    pub account_id: AccountId,
    pub subject: String,
    pub snippet: String,
    /// Distinct senders in the thread, oldest first.
    pub senders: Vec<Address>,
    /// Unix milliseconds of the newest message.
    pub last_message_at: i64,
    pub message_count: u32,
    pub unread: bool,
    pub starred: bool,
    pub has_attachments: bool,
    /// Has the INBOX label (so "archive" applies; otherwise "move to Inbox").
    pub in_inbox: bool,
    /// Wholly in the Trash (so "restore" applies; otherwise "trash").
    pub in_trash: bool,
    /// User labels on the thread (all of the thread's own account).
    pub label_ids: Vec<LabelId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPage {
    pub threads: Vec<ThreadSummary>,
    pub next_cursor: Option<ListCursor>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MessageMeta {
    pub id: MessageId,
    pub account_id: AccountId,
    pub thread_id: ThreadId,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub subject: String,
    pub snippet: String,
    /// Unix milliseconds.
    pub internal_date: i64,
    pub unread: bool,
    pub starred: bool,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    pub thread: ThreadSummary,
    pub messages: Vec<MessageMeta>,
    /// User labels on this thread (all belong to the thread's account).
    pub labels: Vec<Label>,
}

/// Per-account sync status, shown in the sidebar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SyncStatus {
    Idle,
    Syncing,
    Backoff,
    AuthError,
    Error,
}

impl SyncStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SyncStatus::Idle => "idle",
            SyncStatus::Syncing => "syncing",
            SyncStatus::Backoff => "backoff",
            SyncStatus::AuthError => "authError",
            SyncStatus::Error => "error",
        }
    }

    pub fn parse(s: &str) -> Self {
        match s {
            "syncing" => SyncStatus::Syncing,
            "backoff" => SyncStatus::Backoff,
            "authError" => SyncStatus::AuthError,
            "error" => SyncStatus::Error,
            _ => SyncStatus::Idle,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountSyncState {
    pub account_id: AccountId,
    pub status: SyncStatus,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub last_sync_at: Option<i64>,
}
