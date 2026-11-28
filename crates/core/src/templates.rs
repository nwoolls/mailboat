//! Templates: emails the owner writes once and starts from, or inserts
//! while writing. Gmail's own templates aren't in its API, so these are the
//! app's: kept on this computer only, in the encrypted cache, and shared by
//! every account (a template is the owner's writing, not a Gmail record, so
//! it has no `account_id`). Delete all data empties the table with the rest.
//!
//! A template's subject and body are HTML from the composer's editor. A
//! field sits in them as `<span data-field="<id>" data-format="<format>">`
//! with the field's name as its text; what each field is (its name and
//! kind) is in `fields`. Filling them in happens in the web view, which
//! formats dates in the computer's language and region
//! (`src/features/templates/model`); this module stores and checks them.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::db::now_millis;
use crate::error::{CoreError, Result};
use crate::model::{Address, TemplateId};

/// The longest name, in characters.
pub const MAX_NAME: usize = 100;
/// The most fields one template may have.
pub const MAX_FIELDS: usize = 50;
/// The largest body, in bytes of HTML (a long email, with room to spare;
/// images in templates are web images, never embedded).
pub const MAX_BODY: usize = 512 * 1024;
/// The largest subject, in bytes of HTML.
pub const MAX_SUBJECT: usize = 4 * 1024;
/// The most people in To, Cc and Bcc together.
pub const MAX_PEOPLE: usize = 200;

/// What a field holds, which decides how it's asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    /// One line of text.
    Text,
    /// Several lines: each becomes a paragraph, or a bullet in a list.
    LongText,
    /// A day.
    Date,
    /// A day and a time, with an optional end time.
    DateTime,
    /// One of a fixed list.
    Choice,
    /// Filled in by the app, and changeable before inserting.
    Auto,
}

/// What an automatic field is filled with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AutoValue {
    /// The first name of the one person in To (left empty for several).
    RecipientFirstName,
    /// The first name on the From address.
    MyFirstName,
    /// Today's date.
    Today,
}

/// The day a date starts on in Fill in: today, tomorrow, or the next one
/// of a weekday (never today itself).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DayDefault {
    Today,
    Tomorrow,
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

/// One field of a template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TemplateField {
    /// Stable within the template; the HTML refers to it.
    pub id: String,
    /// What Fill in asks for, and what the field shows in the editor.
    pub name: String,
    pub kind: FieldKind,
    /// A choice's options, in order.
    pub choices: Vec<String>,
    /// An automatic field's value.
    pub auto: Option<AutoValue>,
    /// A date's starting day.
    pub default_day: Option<DayDefault>,
    /// A date and time with an end time ("from 9:00 PM to 11:00 PM").
    pub end_time: bool,
}

/// A template as written in the editor (to create one or change it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInput {
    pub name: String,
    /// The address to send from; one that's no longer an account is left
    /// to the default.
    pub from: Option<String>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    /// HTML of one line ("" for none).
    pub subject: String,
    /// HTML.
    pub body: String,
    pub fields: Vec<TemplateField>,
}

/// A saved template.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: TemplateId,
    #[serde(flatten)]
    pub input: TemplateInput,
    /// When it was last used to write an email (ms), for ⌘K's order.
    pub used_at: Option<i64>,
}

const COLUMNS: &str =
    "id, name, from_address, to_json, cc_json, bcc_json, subject, body, fields_json, used_at";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Template> {
    fn json<T: serde::de::DeserializeOwned + Default>(text: String) -> T {
        // Written by `save` from the same types, so it reads back; a row
        // that somehow doesn't keeps the rest of the template usable.
        serde_json::from_str(&text).unwrap_or_default()
    }
    Ok(Template {
        id: row.get(0)?,
        input: TemplateInput {
            name: row.get(1)?,
            from: row.get(2)?,
            to: json(row.get(3)?),
            cc: json(row.get(4)?),
            bcc: json(row.get(5)?),
            subject: row.get(6)?,
            body: row.get(7)?,
            fields: json(row.get(8)?),
        },
        used_at: row.get(9)?,
    })
}

/// Every template, by name.
pub fn list(conn: &Connection) -> Result<Vec<Template>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM templates ORDER BY name COLLATE NOCASE, id"
    ))?;
    let rows = stmt
        .query_map([], from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// One template.
pub fn get(conn: &Connection, id: TemplateId) -> Result<Template> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM templates WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound("That template no longer exists.".into()))
}

/// Saves a new template.
pub fn create(conn: &Connection, input: &TemplateInput) -> Result<Template> {
    let input = checked(input)?;
    name_free(conn, &input.name, None)?;
    let now = now_millis();
    conn.execute(
        "INSERT INTO templates
           (name, from_address, to_json, cc_json, bcc_json, subject, body, fields_json,
            created_at, updated_at, name_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
        params![
            input.name,
            input.from,
            to_json(&input.to)?,
            to_json(&input.cc)?,
            to_json(&input.bcc)?,
            input.subject,
            input.body,
            to_json(&input.fields)?,
            now,
            name_key(&input.name),
        ],
    )?;
    get(conn, TemplateId(conn.last_insert_rowid()))
}

/// Replaces a template's content (its last use is kept).
pub fn update(conn: &Connection, id: TemplateId, input: &TemplateInput) -> Result<Template> {
    let input = checked(input)?;
    // Gone first, so a deleted template isn't reported as a clash of names.
    get(conn, id)?;
    name_free(conn, &input.name, Some(id))?;
    let changed = conn.execute(
        "UPDATE templates SET name = ?2, from_address = ?3, to_json = ?4, cc_json = ?5,
           bcc_json = ?6, subject = ?7, body = ?8, fields_json = ?9, updated_at = ?10,
           name_key = ?11
         WHERE id = ?1",
        params![
            id,
            input.name,
            input.from,
            to_json(&input.to)?,
            to_json(&input.cc)?,
            to_json(&input.bcc)?,
            input.subject,
            input.body,
            to_json(&input.fields)?,
            now_millis(),
            name_key(&input.name),
        ],
    )?;
    if changed == 0 {
        return Err(CoreError::NotFound(
            "That template no longer exists.".into(),
        ));
    }
    get(conn, id)
}

/// Deletes a template. Deleting one that's already gone is fine.
pub fn delete(conn: &Connection, id: TemplateId) -> Result<()> {
    conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
    Ok(())
}

/// A copy of a template, named "<name> copy" (or "copy 2", "copy 3"…).
pub fn duplicate(conn: &Connection, id: TemplateId) -> Result<Template> {
    let mut input = get(conn, id)?.input;
    let base: String = input.name.chars().take(MAX_NAME - 8).collect();
    let mut n = 1;
    input.name = loop {
        let name = if n == 1 {
            format!("{base} copy")
        } else {
            format!("{base} copy {n}")
        };
        if name_free(conn, &name, None).is_ok() {
            break name;
        }
        n += 1;
    };
    create(conn, &input)
}

/// Notes that a template was just used, for ⌘K's "recent first".
pub fn mark_used(conn: &Connection, id: TemplateId) -> Result<()> {
    conn.execute(
        "UPDATE templates SET used_at = ?2 WHERE id = ?1",
        params![id, now_millis()],
    )?;
    Ok(())
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| CoreError::Other(e.to_string()))
}

/// A name as compared for clashes: in lower case, beyond ASCII too (SQLite's
/// own NOCASE folds only ASCII, so "Élan" and "élan" would both be allowed).
fn name_key(name: &str) -> String {
    name.to_lowercase()
}

fn name_free(conn: &Connection, name: &str, except: Option<TemplateId>) -> Result<()> {
    let taken: Option<i64> = conn
        .query_row(
            "SELECT id FROM templates WHERE name_key = ?1 AND id IS NOT ?2",
            params![name_key(name), except],
            |r| r.get(0),
        )
        .optional()?;
    match taken {
        Some(_) => Err(CoreError::Invalid(format!(
            "There’s already a template called “{name}”."
        ))),
        None => Ok(()),
    }
}

/// The input tidied (names trimmed, an empty From dropped) and checked.
fn checked(input: &TemplateInput) -> Result<TemplateInput> {
    let invalid = |why: &str| Err(CoreError::Invalid(why.into()));
    let mut out = input.clone();
    out.name = input.name.trim().to_string();
    if out.name.is_empty() {
        return invalid("Give the template a name.");
    }
    if out.name.chars().count() > MAX_NAME {
        return invalid("That name is too long.");
    }
    out.from = input
        .from
        .as_deref()
        .map(str::trim)
        .filter(|f| !f.is_empty())
        .map(str::to_string);
    if out.to.len() + out.cc.len() + out.bcc.len() > MAX_PEOPLE {
        return invalid("That’s too many people for one template.");
    }
    if out.subject.len() > MAX_SUBJECT {
        return invalid("That subject is too long.");
    }
    if out.body.len() > MAX_BODY {
        return invalid("That template is too long.");
    }
    if out.fields.len() > MAX_FIELDS {
        return invalid("That template has too many fields.");
    }
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for field in &mut out.fields {
        // Spaces as one, as the subject shows the name (`[Name]`).
        field.name = field.name.split_whitespace().collect::<Vec<_>>().join(" ");
        if field.id.is_empty() || !ids.insert(field.id.clone()) {
            return invalid("Each field needs an ID of its own.");
        }
        if field.name.is_empty() {
            return invalid("Give each field a name.");
        }
        if field.name.chars().count() > MAX_NAME {
            return invalid("A field’s name is too long.");
        }
        if !names.insert(field.name.to_lowercase()) {
            return Err(CoreError::Invalid(format!(
                "Two fields are called “{}”.",
                field.name
            )));
        }
        // Only what the kind uses is kept, so a field changed from one kind
        // to another doesn't carry the old kind's settings.
        let kind = field.kind;
        if kind != FieldKind::Choice {
            field.choices.clear();
        }
        if kind != FieldKind::Auto {
            field.auto = None;
        }
        if !matches!(kind, FieldKind::Date | FieldKind::DateTime) {
            field.default_day = None;
        }
        if kind != FieldKind::DateTime {
            field.end_time = false;
        }
        match kind {
            FieldKind::Choice => {
                field.choices = field
                    .choices
                    .iter()
                    .map(|c| c.trim().to_string())
                    .filter(|c| !c.is_empty())
                    .collect();
                if field.choices.is_empty() {
                    return Err(CoreError::Invalid(format!(
                        "Give “{}” at least one choice.",
                        field.name
                    )));
                }
            }
            FieldKind::Auto if field.auto.is_none() => {
                return Err(CoreError::Invalid(format!(
                    "Choose what “{}” is filled in with.",
                    field.name
                )));
            }
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn person(name: &str, email: &str) -> Address {
        Address {
            name: Some(name.into()),
            email: email.into(),
        }
    }

    fn field(id: &str, name: &str, kind: FieldKind) -> TemplateField {
        TemplateField {
            id: id.into(),
            name: name.into(),
            kind,
            choices: vec![],
            auto: None,
            default_day: None,
            end_time: false,
        }
    }

    fn change_control() -> TemplateInput {
        TemplateInput {
            name: " Change control ".into(),
            from: Some("alex@northwind.example".into()),
            to: vec![person("Change board", "change-board@northwind.example")],
            cc: vec![person("Priya Raman", "priya@northwind.example")],
            bcc: vec![],
            subject: r#"<p>Change control: <span data-field="w" data-format="monthYear">Window</span></p>"#
                .into(),
            body: r#"<p>Planned for <span data-field="w" data-format="longTime">Window</span>.</p><ul><li><p><span data-field="c">Changes</span></p></li></ul>"#
                .into(),
            fields: vec![
                TemplateField {
                    end_time: true,
                    default_day: Some(DayDefault::Monday),
                    ..field("w", "Window", FieldKind::DateTime)
                },
                field("c", "Changes", FieldKind::LongText),
            ],
        }
    }

    #[test]
    fn a_template_is_saved_and_read_back() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let saved = create(&conn, &change_control()).unwrap();
        assert_eq!(saved.input.name, "Change control");
        assert_eq!(saved.input.to[0].email, "change-board@northwind.example");
        assert_eq!(saved.input.fields.len(), 2);
        assert!(saved.input.fields[0].end_time);
        assert_eq!(saved.used_at, None);
        assert_eq!(list(&conn).unwrap(), vec![saved.clone()]);
        assert_eq!(get(&conn, saved.id).unwrap(), saved);
    }

    #[test]
    fn names_are_unique_ignoring_case() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let first = create(&conn, &change_control()).unwrap();
        let mut again = change_control();
        again.name = "CHANGE CONTROL".into();
        assert!(matches!(create(&conn, &again), Err(CoreError::Invalid(_))));
        // Saving a template under its own name is fine.
        update(&conn, first.id, &again).unwrap();
        assert_eq!(get(&conn, first.id).unwrap().input.name, "CHANGE CONTROL");
        // Beyond ASCII too.
        let mut accented = change_control();
        accented.name = "Élan".into();
        create(&conn, &accented).unwrap();
        accented.name = "élan".into();
        assert!(matches!(
            create(&conn, &accented),
            Err(CoreError::Invalid(_))
        ));
    }

    #[test]
    fn a_deleted_templates_id_is_never_given_out_again() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let first = create(&conn, &change_control()).unwrap();
        delete(&conn, first.id).unwrap();
        let mut other = change_control();
        other.name = "Another".into();
        let second = create(&conn, &other).unwrap();
        assert!(second.id.0 > first.id.0);
        // An editor still open on the deleted one can't save over the new one.
        assert!(matches!(
            update(&conn, first.id, &change_control()),
            Err(CoreError::NotFound(_))
        ));
        assert_eq!(get(&conn, second.id).unwrap().input.name, "Another");
    }

    #[test]
    fn update_changes_the_content_and_keeps_the_last_use() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let t = create(&conn, &change_control()).unwrap();
        mark_used(&conn, t.id).unwrap();
        let used = get(&conn, t.id).unwrap().used_at;
        assert!(used.is_some());
        let mut changed = change_control();
        changed.cc.clear();
        changed.from = Some("  ".into());
        let after = update(&conn, t.id, &changed).unwrap();
        assert!(after.input.cc.is_empty());
        assert_eq!(after.input.from, None, "an empty From is no From");
        assert_eq!(after.used_at, used);
        assert!(matches!(
            update(&conn, TemplateId(999), &changed),
            Err(CoreError::NotFound(_))
        ));
    }

    #[test]
    fn list_is_by_name_and_delete_removes_one() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        for name in ["thanks", "Out next week", "Change control"] {
            let mut t = change_control();
            t.name = name.into();
            create(&conn, &t).unwrap();
        }
        let names = |conn: &Connection| -> Vec<String> {
            list(conn)
                .unwrap()
                .into_iter()
                .map(|t| t.input.name)
                .collect()
        };
        assert_eq!(names(&conn), ["Change control", "Out next week", "thanks"]);
        let id = list(&conn).unwrap()[1].id;
        delete(&conn, id).unwrap();
        delete(&conn, id).unwrap();
        assert_eq!(names(&conn), ["Change control", "thanks"]);
        assert!(matches!(get(&conn, id), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn duplicate_finds_a_free_name() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let t = create(&conn, &change_control()).unwrap();
        let a = duplicate(&conn, t.id).unwrap();
        let b = duplicate(&conn, t.id).unwrap();
        assert_eq!(a.input.name, "Change control copy");
        assert_eq!(b.input.name, "Change control copy 2");
        assert_eq!(a.input.body, t.input.body);
        // A long name still leaves room for " copy".
        let mut long = change_control();
        long.name = "x".repeat(MAX_NAME);
        let l = create(&conn, &long).unwrap();
        let copy = duplicate(&conn, l.id).unwrap();
        assert!(copy.input.name.chars().count() <= MAX_NAME);
    }

    #[test]
    fn bad_input_is_refused_with_a_reason() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let refused = |change: fn(&mut TemplateInput)| {
            let mut t = change_control();
            change(&mut t);
            match create(&conn, &t) {
                Err(CoreError::Invalid(why)) => why,
                other => panic!("expected a refusal, got {other:?}"),
            }
        };
        assert_eq!(
            refused(|t| t.name = "  ".into()),
            "Give the template a name."
        );
        assert_eq!(
            refused(|t| t.name = "x".repeat(MAX_NAME + 1)),
            "That name is too long."
        );
        assert_eq!(
            refused(|t| t.body = "x".repeat(MAX_BODY + 1)),
            "That template is too long."
        );
        assert_eq!(
            refused(|t| t.fields[1].id = "w".into()),
            "Each field needs an ID of its own."
        );
        assert_eq!(
            refused(|t| t.fields[1].name = " window".into()),
            "Two fields are called “window”."
        );
        assert_eq!(
            refused(|t| t.fields[1].kind = FieldKind::Choice),
            "Give “Changes” at least one choice."
        );
        assert_eq!(
            refused(|t| t.fields[1].kind = FieldKind::Auto),
            "Choose what “Changes” is filled in with."
        );
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_field_keeps_only_what_its_kind_uses() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let mut t = change_control();
        // Was a date and time with an end; now a choice.
        t.fields[0].kind = FieldKind::Choice;
        t.fields[0].choices = vec![" Standard ".into(), "".into(), "Emergency".into()];
        t.fields[1].auto = Some(AutoValue::Today);
        // Spaces as one, as the subject shows a field left empty (`[Next step]`).
        t.fields[1].name = "  Next   step ".into();
        let saved = create(&conn, &t).unwrap();
        assert_eq!(saved.input.fields[1].name, "Next step");
        let w = &saved.input.fields[0];
        assert_eq!(w.choices, ["Standard", "Emergency"]);
        assert!(!w.end_time);
        assert_eq!(w.default_day, None);
        assert_eq!(saved.input.fields[1].auto, None);
    }

    #[test]
    fn demo_modes_templates_are_valid() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let demo = crate::demo::DemoData::builtin().templates;
        assert!(demo.len() >= 3);
        for template in &demo {
            create(&conn, &template.into()).unwrap();
        }
        // Every field is used, and every field in the HTML is described.
        for t in list(&conn).unwrap() {
            let html = format!("{}{}", t.input.subject, t.input.body);
            for f in &t.input.fields {
                let mark = format!("data-field=\"{}\"", f.id);
                assert!(html.contains(&mark), "{}: {} unused", t.input.name, f.name);
            }
            assert_eq!(
                html.matches("data-field=").count(),
                t.input
                    .fields
                    .iter()
                    .map(|f| html.matches(&format!("data-field=\"{}\"", f.id)).count())
                    .sum::<usize>(),
                "{}: a field in the HTML isn't described",
                t.input.name
            );
        }
    }

    #[test]
    fn templates_belong_to_no_account_and_go_with_delete_all_data() {
        let db = Db::open_in_memory().unwrap();
        let mut conn = db.conn();
        let account = crate::db::accounts::upsert(
            &conn,
            &crate::db::accounts::NewAccount {
                google_sub: "sub-alex",
                email: "alex@northwind.example",
                display_name: Some("Alex Rivera"),
                avatar_url: None,
                oauth_client: "test",
            },
        )
        .unwrap()
        .id;
        create(&conn, &change_control()).unwrap();
        // Removing the account (its rows go by cascade) keeps templates.
        conn.execute("DELETE FROM accounts WHERE id = ?1", [account])
            .unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        crate::db::erase::erase_all(&mut conn).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }
}
