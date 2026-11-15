//! Creating, renaming, recoloring, showing or hiding and deleting user
//! labels, with the owning account's client. Labels nest by name
//! (`Parent/Child`), so renaming a label also renames the labels under it,
//! as Gmail does.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::{params, OptionalExtension};

use crate::db::Db;
use crate::error::{CoreError, Result};
use crate::gmail::GmailClient;
use crate::model::{AccountId, Label, LabelId, LabelKind, LabelSidebar};

fn clean(name: &str) -> Result<String> {
    let name = name.split('/').map(str::trim).collect::<Vec<_>>().join("/");
    if name.is_empty() || name.split('/').any(str::is_empty) {
        return Err(CoreError::Invalid("A label needs a name.".into()));
    }
    Ok(name)
}

/// Gmail answers 409 when the name is taken.
fn friendly(e: CoreError, name: &str) -> CoreError {
    match e {
        CoreError::Api { status: 409, .. } => {
            CoreError::Invalid(format!("There's already a label called “{name}”."))
        }
        e => e,
    }
}

/// One change at a time per label, across its read, its write and the
/// cache: a change rewrites the whole label (`change`), so two at once could
/// each read the original and the second undo the first; renaming and
/// deleting take their turn too.
async fn turn(id: LabelId) -> tokio::sync::OwnedMutexGuard<()> {
    static TURNS: OnceLock<Mutex<HashMap<LabelId, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let lock = {
        let mut turns = TURNS
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        turns.entry(id).or_default().clone()
    };
    lock.lock_owned().await
}

fn user_label(db: &Db, id: LabelId) -> Result<(AccountId, String, String)> {
    let row: Option<(AccountId, String, String, String)> = db
        .conn()
        .query_row(
            "SELECT account_id, gmail_label_id, name, kind FROM labels WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    match row {
        Some((account, gmail_id, name, kind)) if kind == "user" => Ok((account, gmail_id, name)),
        Some(_) => Err(CoreError::Invalid(
            "Gmail's own labels can't be changed.".into(),
        )),
        None => Err(CoreError::NotFound(format!("label {}", id.0))),
    }
}

/// Creates a label in one account and caches it.
pub async fn create(db: &Db, gmail: &GmailClient, account: AccountId, name: &str) -> Result<Label> {
    let name = clean(name)?;
    let made = gmail
        .create_label(&name)
        .await
        .map_err(|e| friendly(e, &name))?;
    let conn = db.conn();
    conn.execute(
        "INSERT INTO labels (account_id, gmail_label_id, name, kind) VALUES (?1, ?2, ?3, 'user')
         ON CONFLICT (account_id, gmail_label_id) DO UPDATE SET name = excluded.name",
        params![account, made.id, made.name],
    )?;
    let id: LabelId = conn.query_row(
        "SELECT id FROM labels WHERE account_id = ?1 AND gmail_label_id = ?2",
        params![account, made.id],
        |r| r.get(0),
    )?;
    Ok(Label {
        id,
        account_id: account,
        gmail_label_id: made.id,
        name: made.name,
        kind: LabelKind::User,
        color_bg: None,
        color_fg: None,
        sidebar: LabelSidebar::Show,
        on_conversations: true,
    })
}

/// Renames a label, and the labels nested under it.
pub async fn rename(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    id: LabelId,
    name: &str,
) -> Result<()> {
    let _turn = turn(id).await;
    let (account, gmail_id, old) = user_label(db, id)?;
    let name = clean(name)?;
    if name == old {
        return Ok(());
    }
    let gmail = gmail_for(account)?;
    gmail
        .rename_label(&gmail_id, &name)
        .await
        .map_err(|e| friendly(e, &name))?;
    db.conn().execute(
        "UPDATE labels SET name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    // Nested labels follow (`Old/Sub` becomes `New/Sub`).
    let prefix = format!("{old}/");
    let children: Vec<(LabelId, String, String)> = {
        let conn = db.conn();
        let mut stmt = conn.prepare(
            "SELECT id, gmail_label_id, name FROM labels
             WHERE account_id = ?1 AND kind = 'user' AND substr(name, 1, ?3) = ?2",
        )?;
        let rows = stmt.query_map(
            params![account, prefix, prefix.chars().count() as i64],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        rows.collect::<rusqlite::Result<_>>()?
    };
    for (child, child_gmail, child_name) in children {
        let renamed = format!("{name}/{}", &child_name[prefix.len()..]);
        gmail.rename_label(&child_gmail, &renamed).await?;
        db.conn().execute(
            "UPDATE labels SET name = ?2 WHERE id = ?1",
            params![child, renamed],
        )?;
    }
    Ok(())
}

/// Deletes a label from its account. Its conversations stay; only the
/// label comes off them (as in Gmail).
pub async fn delete(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    id: LabelId,
) -> Result<()> {
    let _turn = turn(id).await;
    let (account, gmail_id, _) = user_label(db, id)?;
    gmail_for(account)?.delete_label(&gmail_id).await?;
    db.conn()
        .execute("DELETE FROM labels WHERE id = ?1", [id])?;
    Ok(())
}

/// The label colors offered: Gmail's own picker's 8 × 8 grid, the first 64
/// of the colors `labels.update` accepts (Gmail refuses any other), in its
/// order: grays, then rows of the same hues from saturated to dark.
pub const PALETTE: [&str; 64] = [
    "#000000", "#434343", "#666666", "#999999", "#cccccc", "#efefef", "#f3f3f3", "#ffffff",
    "#fb4c2f", "#ffad47", "#fad165", "#16a766", "#43d692", "#4a86e8", "#a479e2", "#f691b3",
    "#f6c5be", "#ffe6c7", "#fef1d1", "#b9e4d0", "#c6f3de", "#c9daf8", "#e4d7f5", "#fcdee8",
    "#efa093", "#ffd6a2", "#fce8b3", "#89d3b2", "#a0eac9", "#a4c2f4", "#d0bcf1", "#fbc8d9",
    "#e66550", "#ffbc6b", "#fcda83", "#44b984", "#68dfa9", "#6d9eeb", "#b694e8", "#f7a7c0",
    "#cc3a21", "#eaa041", "#f2c960", "#149e60", "#3dc789", "#3c78d8", "#8e63ce", "#e07798",
    "#ac2b16", "#cf8933", "#d5ae49", "#0b804b", "#2a9c68", "#285bac", "#653e9b", "#b65775",
    "#822111", "#a46a21", "#aa8831", "#076239", "#1a764d", "#1c4587", "#41236d", "#83334c",
];

/// WCAG relative luminance of a `#rrggbb` color (0 black to 1 white).
fn luminance(hex: &str) -> f64 {
    let hex = hex.trim_start_matches('#');
    let channel = |i: usize| {
        let c = f64::from(u8::from_str_radix(hex.get(i..i + 2).unwrap_or("0"), 16).unwrap_or(0))
            / 255.0;
        if c <= 0.040_45 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/// The WCAG contrast ratio between two colors (1 to 21).
pub fn contrast(a: &str, b: &str) -> f64 {
    let (a, b) = (luminance(a), luminance(b));
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// The text color for a label of `background`: black or white (both in
/// Gmail's list), whichever contrasts more, so its name stays readable.
pub fn text_color_for(background: &str) -> &'static str {
    if contrast(background, "#000000") >= contrast(background, "#ffffff") {
        "#000000"
    } else {
        "#ffffff"
    }
}

/// One change to how a label looks or where it shows.
#[derive(Debug, Clone, PartialEq)]
pub enum LabelChange {
    /// A color from `PALETTE`, or none.
    Color(Option<String>),
    /// Where it shows in the sidebar.
    Sidebar(LabelSidebar),
    /// Whether it shows on conversations in the list.
    OnConversations(bool),
}

/// Changes a label's color or visibility in Gmail and in the cache. The
/// label is read from Gmail first and written back whole with only that
/// change (`labels.update`), so nothing changed elsewhere since the last
/// sync is undone; a color is removed by leaving it out.
pub async fn change(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    id: LabelId,
    change: LabelChange,
) -> Result<()> {
    let _turn = turn(id).await;
    let (account, gmail_id, _) = user_label(db, id)?;
    if let LabelChange::Color(Some(color)) = &change {
        if !PALETTE.contains(&color.as_str()) {
            return Err(CoreError::Invalid(
                "That isn't one of Gmail's label colors.".into(),
            ));
        }
    }
    let gmail = gmail_for(account)?;
    let mut label = gmail.get_label(&gmail_id).await?;
    let fields = label
        .as_object_mut()
        .ok_or_else(|| CoreError::Other("label: not an object".into()))?;
    // Counts Gmail reports alongside; not part of what is written back.
    for count in [
        "messagesTotal",
        "messagesUnread",
        "threadsTotal",
        "threadsUnread",
    ] {
        fields.remove(count);
    }
    match &change {
        LabelChange::Color(Some(color)) => {
            fields.insert(
                "color".into(),
                serde_json::json!({
                    "backgroundColor": color,
                    "textColor": text_color_for(color),
                }),
            );
        }
        LabelChange::Color(None) => {
            fields.remove("color");
        }
        LabelChange::Sidebar(sidebar) => {
            fields.insert("labelListVisibility".into(), sidebar.as_gmail().into());
        }
        LabelChange::OnConversations(show) => {
            fields.insert(
                "messageListVisibility".into(),
                if *show { "show" } else { "hide" }.into(),
            );
        }
    }
    gmail.update_label(&gmail_id, &label).await?;
    let conn = db.conn();
    match change {
        LabelChange::Color(color) => {
            let text = color.as_deref().map(text_color_for);
            conn.execute(
                "UPDATE labels SET color_bg = ?2, color_fg = ?3 WHERE id = ?1",
                params![id, color, text],
            )?;
        }
        LabelChange::Sidebar(sidebar) => {
            conn.execute(
                "UPDATE labels SET list_visibility = ?2 WHERE id = ?1",
                params![id, sidebar.as_gmail()],
            )?;
        }
        LabelChange::OnConversations(show) => {
            conn.execute(
                "UPDATE labels SET message_visibility = ?2 WHERE id = ?1",
                params![id, if show { "show" } else { "hide" }],
            )?;
        }
    }
    Ok(())
}
