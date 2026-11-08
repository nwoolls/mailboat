//! SQLite schema. Every Gmail-derived table carries `account_id` and a
//! `UNIQUE(account_id, gmail_*_id)` pair, because Gmail IDs are only unique
//! within one mailbox. Child tables reference parents through composite
//! `(account_id, id)` foreign keys, so a row can never point at another
//! account's thread or label.

pub const MIGRATION_V1: &str = r#"
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  color TEXT NOT NULL,
  oauth_client TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE labels (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_label_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'user')),
  color_bg TEXT,
  color_fg TEXT,
  UNIQUE (account_id, gmail_label_id),
  UNIQUE (account_id, id)
);

CREATE TABLE threads (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  senders_json TEXT NOT NULL DEFAULT '[]',
  last_message_at INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, gmail_thread_id),
  UNIQUE (account_id, id)
);
CREATE INDEX threads_by_date ON threads (last_message_at DESC, id DESC);
CREATE INDEX threads_by_account_date ON threads (account_id, last_message_at DESC, id DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id INTEGER NOT NULL,
  gmail_message_id TEXT NOT NULL,
  internal_date INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  from_name TEXT,
  from_email TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  rfc822_message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, gmail_message_id),
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads (account_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_by_thread ON messages (thread_id, internal_date);

CREATE TABLE message_labels (
  account_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (message_id, label_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, label_id) REFERENCES labels (account_id, id) ON DELETE CASCADE
);
CREATE INDEX message_labels_by_label ON message_labels (label_id);

-- Derived: the union of a thread's message labels. Rebuilt whenever a thread
-- changes, so list views never have to scan messages.
CREATE TABLE thread_labels (
  account_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (thread_id, label_id),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads (account_id, id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, label_id) REFERENCES labels (account_id, id) ON DELETE CASCADE
);
CREATE INDEX thread_labels_by_label ON thread_labels (label_id, thread_id);

CREATE TABLE message_bodies (
  message_id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  html TEXT,
  text TEXT,
  fetched_at INTEGER NOT NULL,
  FOREIGN KEY (account_id, message_id) REFERENCES messages (account_id, id) ON DELETE CASCADE
);

-- Gmail attachment IDs are not stable between fetches, so attachments are
-- keyed by their MIME part ID within the message.
CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  part_id TEXT NOT NULL,
  gmail_attachment_id TEXT,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  cached_path TEXT,
  UNIQUE (account_id, message_id, part_id),
  FOREIGN KEY (account_id, message_id) REFERENCES messages (account_id, id) ON DELETE CASCADE
);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  gmail_draft_id TEXT NOT NULL,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, gmail_draft_id)
);

CREATE TABLE sync_state (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  history_id INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  error_kind TEXT,
  error_message TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  backoff_until INTEGER,
  last_full_sync_at INTEGER,
  last_sync_at INTEGER
);

-- Describes a sender, not mailbox data, so it is deliberately global.
CREATE TABLE sender_image_prefs (
  sender_email TEXT PRIMARY KEY COLLATE NOCASE,
  allow_images INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Full-text index over all accounts. rowid = messages.id.
CREATE VIRTUAL TABLE messages_fts USING fts5 (
  subject, sender, recipients, snippet, body,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;
"#;

/// Resumable full sync: remember the full sync in progress (its starting
/// historyId and start time) and when each thread was last written, so an
/// interrupted sync skips threads it already fetched instead of starting over.
pub const MIGRATION_V2: &str = r#"
ALTER TABLE threads ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN full_sync_history_id INTEGER;
ALTER TABLE sync_state ADD COLUMN full_sync_started_at INTEGER;
"#;

/// Which sync scope an account's cache covers (see `sync::engine::SCOPE_VERSION`).
/// Accounts synced under an older, narrower scope get a one-time widening pass.
pub const MIGRATION_V3: &str = r#"
ALTER TABLE sync_state ADD COLUMN scope_version INTEGER NOT NULL DEFAULT 0;
"#;

/// Received attachments (Milestone 3). `inline` marks parts the HTML body
/// shows itself (`cid:` images), which the reader doesn't list as files.
/// `parts_version` says which attachment rules a cached body was read
/// with; bodies cached before attachments were recorded are re-fetched
/// once when next opened (see `store::PARTS_VERSION`).
pub const MIGRATION_V4: &str = r#"
ALTER TABLE attachments ADD COLUMN inline INTEGER NOT NULL DEFAULT 0;
ALTER TABLE message_bodies ADD COLUMN parts_version INTEGER NOT NULL DEFAULT 0;
"#;

/// Sync's header-only fetch never saw attachments, so no cached thread had
/// a paperclip. `attachments_version` records the one-time catch-up that
/// asks Gmail which messages have attachments (`has:attachment`).
pub const MIGRATION_V5: &str = r#"
ALTER TABLE sync_state ADD COLUMN attachments_version INTEGER NOT NULL DEFAULT 0;
"#;

/// Bodies fetched by the first Milestone 3 build recorded attachments but
/// didn't update the paperclip flag, and the catch-up skips messages whose
/// body is known. Recompute the flag from their attachment lists.
pub const MIGRATION_V6: &str = r#"
UPDATE messages SET has_attachments =
  EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = messages.id AND NOT a.inline)
WHERE EXISTS (SELECT 1 FROM message_bodies b WHERE b.message_id = messages.id AND b.parts_version >= 1);
UPDATE threads SET has_attachments =
  EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = threads.id AND m.has_attachments);
"#;

/// Compose (Milestone 4). `reply_to_json` is the Reply-To header, which
/// replies go to instead of From; NULL means "not known yet" (synced before
/// sync asked for it), and is filled in on demand when replying.
/// `send_as` holds each account's Gmail "Send mail as" addresses (the
/// main address included), which compose offers as From.
pub const MIGRATION_V7: &str = r#"
ALTER TABLE messages ADD COLUMN reply_to_json TEXT;

CREATE TABLE send_as (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  reply_to TEXT,
  signature TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, email)
);
"#;

/// People from each account's Google Contacts (`saved`) and Gmail's
/// automatic "other contacts" (`other`), for address suggestions.
pub const MIGRATION_V8: &str = r#"
CREATE TABLE google_contacts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('saved', 'other')),
  UNIQUE (account_id, email, kind)
);
"#;

/// Conversations Gmail's own search matched (`q=`), per account and search
/// text, so the Search view shows them even when the match was in a part
/// the app hasn't downloaded (like the body).
pub const MIGRATION_V9: &str = r#"
CREATE TABLE search_hits (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  query TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  UNIQUE (account_id, query, thread_id),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads (account_id, id) ON DELETE CASCADE
);
"#;

/// Each sender in a thread's list row now says whether they have unread
/// mail in it (bold in the list, as in Gmail). Rebuild every thread's
/// sender list with that flag, keeping the order senders first wrote in.
pub const MIGRATION_V10: &str = r#"
UPDATE threads SET senders_json = COALESCE((
  SELECT json_group_array(json_object('name', name, 'email', email, 'unread', json(unread)))
  FROM (
    SELECT m.from_name AS name, m.from_email AS email, MIN(m.internal_date) AS first,
           CASE WHEN MAX(EXISTS (SELECT 1 FROM message_labels ml JOIN labels l ON l.id = ml.label_id
                                 WHERE ml.message_id = m.id AND l.gmail_label_id = 'UNREAD'))
                THEN 'true' ELSE 'false' END AS unread
    FROM messages m
    WHERE m.thread_id = threads.id AND m.from_email != ''
    GROUP BY lower(m.from_email)
    ORDER BY first
  )
), '[]');
"#;

/// App-wide settings from the Settings page that Rust acts on (see
/// `crate::settings`), stored as JSON under a key so new settings need no
/// migration.
pub const MIGRATION_V11: &str = r#"
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

/// The Google permissions each account's sign-in carries (space-separated,
/// as Google reports them on sign-in and every token refresh), so features
/// needing a newer permission can ask the account to sign in again. NULL
/// until the first refresh after updating.
pub const MIGRATION_V12: &str = r#"
ALTER TABLE accounts ADD COLUMN granted_scopes TEXT;
"#;

/// A message's calendar part (meeting invitations), kept with its body.
/// `calendar_read` says the body was read looking for one, so `calendar`
/// NULL means "none" rather than "not looked at" (bodies cached earlier).
pub const MIGRATION_V13: &str = r#"
ALTER TABLE message_bodies ADD COLUMN calendar TEXT;
ALTER TABLE message_bodies ADD COLUMN calendar_read INTEGER NOT NULL DEFAULT 0;
"#;

/// Remote images downloaded when mail arrives (`mail::prefetch`), so
/// opening an email doesn't tell its sender when. Keyed by address, not by
/// account: the same image is the same file whichever account received it
/// (per account since `MIGRATION_V21`). The bytes are files named by `id` in the image cache folder.
/// `images_prefetched` marks bodies already handled (fetched, or opened
/// first, when images load live anyway).
pub const MIGRATION_V14: &str = r#"
CREATE TABLE image_cache (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL
);
ALTER TABLE message_bodies ADD COLUMN images_prefetched INTEGER NOT NULL DEFAULT 0;
"#;

/// AI (AI Spike). `ai_summaries` caches each conversation's summaries:
/// `line` for the list, `full` for above the opened conversation. A
/// summary is current while the conversation's newest message is still
/// `newest_message_id`. `ai_usage` records each request's size and cost,
/// never its content; it describes this Mac's use, not mail, so it has no
/// account.
pub const MIGRATION_V15: &str = r#"
CREATE TABLE ai_summaries (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('line', 'full')),
  provider TEXT NOT NULL,
  newest_message_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, thread_id, kind),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads (account_id, id) ON DELETE CASCADE
);

CREATE TABLE ai_usage (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL,
  ok INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL
);
CREATE INDEX ai_usage_by_time ON ai_usage (at);
"#;

/// The writing assistant's suggestion chips per conversation (AI Spike),
/// kept like summaries: current while the conversation's newest message is
/// still `newest_message_id`. `forward` separates a forward's chips from a
/// reply's. `ideas` is a JSON array of strings.
pub const MIGRATION_V16: &str = r#"
CREATE TABLE ai_reply_ideas (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  forward INTEGER NOT NULL,
  newest_message_id INTEGER NOT NULL,
  ideas TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, thread_id, forward),
  FOREIGN KEY (account_id, thread_id) REFERENCES threads (account_id, id) ON DELETE CASCADE
);
"#;

/// Senders whose emails open with their original colors on the white card
/// (the reader's "Original colors"), kept by address like
/// `sender_image_prefs`: it describes a sender, not mailbox data.
pub const MIGRATION_V17: &str = r#"
CREATE TABLE sender_color_prefs (
  sender_email TEXT PRIMARY KEY COLLATE NOCASE,
  updated_at INTEGER NOT NULL
);
"#;

/// What AI apps asked of the MCP server (AI Spike 2): which tool, for
/// which account and conversation, and a line about it (the search words,
/// how many results), never email content. Kept 30 days (`mcp::log`).
pub const MIGRATION_V18: &str = r#"
CREATE TABLE mcp_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  client TEXT NOT NULL,
  tool TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
  thread_id INTEGER,
  detail TEXT NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX mcp_log_by_time ON mcp_log (at);
"#;

/// Account IDs are never reused. `accounts.id` alone hands a removed
/// account's ID to the next one added, and anything still keyed by it
/// (AI apps' access in the settings, say) would quietly apply to a
/// different mailbox. `account_id_seq` holds the highest ID ever given out
/// (`accounts::upsert`). Grants for accounts already removed are dropped,
/// so none can carry over.
pub const MIGRATION_V19: &str = r#"
CREATE TABLE account_id_seq (last INTEGER NOT NULL);
INSERT INTO account_id_seq (last) SELECT COALESCE(MAX(id), 0) FROM accounts;
UPDATE app_settings SET value = json_set(value,
  '$.mcp.read', json((SELECT json_group_array(j.value) FROM json_each(app_settings.value, '$.mcp.read') j
                      WHERE j.value IN (SELECT id FROM accounts))),
  '$.mcp.drafts', json((SELECT json_group_array(j.value) FROM json_each(app_settings.value, '$.mcp.drafts') j
                        WHERE j.value IN (SELECT id FROM accounts))))
WHERE key = 'app' AND json_valid(value) AND json_type(value, '$.mcp') = 'object';
"#;

/// Gmail's search hits are kept apart for searches that took in Spam and
/// Trash now (`query::search_key`, code review R4-01). Hits saved before
/// can't be told apart, so they go: they're a cache, filled again the
/// next time Gmail is searched.
pub const MIGRATION_V20: &str = r#"
DELETE FROM search_hits;
"#;

/// The image cache is kept per account (it was shared by address): each
/// account's copies live in its own folder, so removing the account deletes
/// its rows with it (`ON DELETE CASCADE`) and its folder, and nothing is
/// keyed by an address alone. The cache held in the old shape can't be told
/// apart by account, so it goes: it is a cache, and the images of that mail
/// load live as an evicted image does (the old files are swept at start-up).
pub const MIGRATION_V21: &str = r#"
DROP TABLE image_cache;
CREATE TABLE image_cache (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL,
  UNIQUE (account_id, url)
);
"#;
