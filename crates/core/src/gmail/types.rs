//! Gmail REST API response shapes (only the fields the app uses).
//! Reference: https://developers.google.com/gmail/api/reference/rest

use serde::{Deserialize, Deserializer, Serialize};

/// Gmail sends 64-bit numbers (historyId, internalDate) as strings.
fn u64_from_string<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let s = String::deserialize(d)?;
    s.parse().map_err(serde::de::Error::custom)
}

fn opt_u64_from_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    let s: Option<String> = Option::deserialize(d)?;
    s.map(|s| s.parse().map_err(serde::de::Error::custom))
        .transpose()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub email_address: String,
    #[serde(deserialize_with = "u64_from_string")]
    pub history_id: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LabelList {
    #[serde(default)]
    pub labels: Vec<Label>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    /// "system" or "user".
    #[serde(rename = "type", default)]
    pub label_type: Option<String>,
    #[serde(default)]
    pub color: Option<LabelColor>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelColor {
    pub background_color: Option<String>,
    pub text_color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadList {
    #[serde(default)]
    pub threads: Vec<ThreadRef>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThreadRef {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    #[serde(default, deserialize_with = "opt_u64_from_string")]
    pub history_id: Option<u64>,
    #[serde(default)]
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub snippet: String,
    #[serde(default, deserialize_with = "opt_u64_from_string")]
    pub internal_date: Option<u64>,
    pub payload: Option<MessagePart>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePart {
    pub part_id: Option<String>,
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    pub body: Option<PartBody>,
    #[serde(default)]
    pub parts: Vec<MessagePart>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartBody {
    pub attachment_id: Option<String>,
    #[serde(default)]
    pub size: u64,
    /// base64url-encoded content.
    pub data: Option<String>,
}

/// `messages.list` response (IDs only).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageList {
    #[serde(default)]
    pub messages: Vec<MessageRef>,
    pub next_page_token: Option<String>,
}

/// `messages.get` with `format=raw`.
#[derive(Debug, Clone, Deserialize)]
pub struct RawMessage {
    /// base64url-encoded RFC 5322 message.
    #[serde(default)]
    pub raw: String,
}

/// `messages.attachments.get` response.
#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentBody {
    /// base64url-encoded content.
    #[serde(default)]
    pub data: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryList {
    #[serde(default)]
    pub history: Vec<History>,
    pub next_page_token: Option<String>,
    #[serde(default, deserialize_with = "opt_u64_from_string")]
    pub history_id: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(default)]
    pub messages: Vec<MessageRef>,
    #[serde(default)]
    pub messages_added: Vec<HistoryMessage>,
    #[serde(default)]
    pub messages_deleted: Vec<HistoryMessage>,
    #[serde(default)]
    pub labels_added: Vec<HistoryMessage>,
    #[serde(default)]
    pub labels_removed: Vec<HistoryMessage>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HistoryMessage {
    pub message: MessageRef,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRef {
    pub id: String,
    pub thread_id: String,
}

/// A saved draft (`drafts.create` / `drafts.update`).
#[derive(Debug, Clone, Deserialize)]
pub struct DraftRef {
    pub id: String,
    pub message: MessageRef,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DraftList {
    #[serde(default)]
    pub drafts: Vec<DraftRef>,
}

/// A page of People API contacts (saved ones come as `connections`,
/// automatic ones as `otherContacts`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeoplePage {
    #[serde(default)]
    pub connections: Vec<Person>,
    #[serde(default)]
    pub other_contacts: Vec<Person>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    #[serde(default)]
    pub names: Vec<PersonName>,
    #[serde(default)]
    pub email_addresses: Vec<PersonEmail>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonName {
    #[serde(default)]
    pub display_name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct PersonEmail {
    #[serde(default)]
    pub value: String,
}

/// `settings.sendAs.list`: the addresses an account can send as.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAsList {
    #[serde(default)]
    pub send_as: Vec<SendAs>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAs {
    pub send_as_email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub reply_to_address: Option<String>,
    /// HTML, as set in Gmail's settings.
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub is_primary: bool,
    #[serde(default)]
    pub is_default: bool,
    /// "accepted" once Gmail has verified an alias; the primary has none.
    #[serde(default)]
    pub verification_status: Option<String>,
}

/// Google's error envelope: `{"error": {"code", "message", "errors": [{"reason"}]}}`.
#[derive(Debug, Clone, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorBody {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub errors: Vec<ErrorItem>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorItem {
    #[serde(default)]
    pub reason: String,
}

/// `settings.filters.list` response.
#[derive(Debug, Clone, Deserialize)]
pub struct FilterList {
    #[serde(default)]
    pub filter: Vec<Filter>,
}

/// A Gmail filter (what the app calls a rule). Sent back to Gmail as well,
/// so empty fields are left out.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default)]
    pub criteria: FilterCriteria,
    #[serde(default)]
    pub action: FilterAction,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCriteria {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// "Has the words": any Gmail search.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// "Doesn't have".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub negated_query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_chats: Option<bool>,
    /// Bytes, compared by `size_comparison`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u32>,
    /// "larger", "smaller" or "unspecified".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size_comparison: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterAction {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub add_label_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remove_label_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forward: Option<String>,
}

/// `settings.getVacation` / `updateVacation`. Times are epoch ms strings.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vacation {
    #[serde(default)]
    pub enable_auto_reply: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body_plain_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_body_html: Option<String>,
    #[serde(default)]
    pub restrict_to_contacts: bool,
    #[serde(default)]
    pub restrict_to_domain: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
}
