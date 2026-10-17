//! Creating, renaming and deleting user labels, with the owning account's
//! client. Labels nest by name (`Parent/Child`), so renaming a label also
//! renames the labels under it, as Gmail does.

use rusqlite::{params, OptionalExtension};

use crate::db::Db;
use crate::error::{CoreError, Result};
use crate::gmail::GmailClient;
use crate::model::{AccountId, Label, LabelId, LabelKind};

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
    })
}

/// Renames a label, and the labels nested under it.
pub async fn rename(
    db: &Db,
    gmail_for: impl Fn(AccountId) -> Result<GmailClient>,
    id: LabelId,
    name: &str,
) -> Result<()> {
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
    let (account, gmail_id, _) = user_label(db, id)?;
    gmail_for(account)?.delete_label(&gmail_id).await?;
    db.conn()
        .execute("DELETE FROM labels WHERE id = ?1", [id])?;
    Ok(())
}
