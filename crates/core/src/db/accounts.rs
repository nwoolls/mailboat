use rusqlite::{params, Connection, OptionalExtension, Row};

use super::now_millis;
use crate::auth::oauth::{
    CALENDAR_SCOPE, CONTACTS_SCOPE, GMAIL_SETTINGS_SCOPE, LEGACY_CALENDAR_SCOPE,
};
use crate::error::{CoreError, Result};
use crate::model::{Account, AccountId, Permission};

/// Calm, distinguishable account colors, assigned in order.
pub const ACCOUNT_COLORS: [&str; 8] = [
    "#5b8def", "#e0795b", "#4fb38a", "#b07ad9", "#d9a83f", "#4fb0c6", "#d9668f", "#8a9a5b",
];

pub struct NewAccount<'a> {
    pub google_sub: &'a str,
    pub email: &'a str,
    pub display_name: Option<&'a str>,
    pub avatar_url: Option<&'a str>,
    pub oauth_client: &'a str,
}

const COLUMNS: &str = "id, email, display_name, avatar_url, color, oauth_client, granted_scopes";

fn from_row(row: &Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        avatar_url: row.get(3)?,
        color: row.get(4)?,
        oauth_client: row.get(5)?,
        missing_permissions: missing(row.get::<_, Option<String>>(6)?.as_deref()),
    })
}

/// The optional permissions not among `granted` (space-separated, as
/// stored). Not known yet (`None`, until the first token refresh after
/// updating) counts as none granted. Any one of a permission's scopes
/// grants it: Calendar is either the scope asked for now or the broader
/// one asked for before (`LEGACY_CALENDAR_SCOPE`), so an account that
/// granted the old one isn't asked to sign in again.
fn missing(granted: Option<&str>) -> Vec<Permission> {
    let granted: Vec<&str> = granted.unwrap_or("").split_whitespace().collect();
    let permissions: [(Permission, &[&str]); 3] = [
        (Permission::Contacts, &[CONTACTS_SCOPE]),
        (
            Permission::Calendar,
            &[CALENDAR_SCOPE, LEGACY_CALENDAR_SCOPE],
        ),
        (Permission::GmailSettings, &[GMAIL_SETTINGS_SCOPE]),
    ];
    permissions
        .into_iter()
        .filter(|(_, scopes)| !scopes.iter().any(|s| granted.contains(s)))
        .map(|(p, _)| p)
        .collect()
}

/// Records the permissions an account's sign-in carries (from Google's
/// token responses). Returns whether they changed.
pub fn set_granted_scopes(conn: &Connection, id: AccountId, scopes: &[String]) -> Result<bool> {
    let mut sorted: Vec<&str> = scopes.iter().map(String::as_str).collect();
    sorted.sort_unstable();
    sorted.dedup();
    let changed = conn.execute(
        "UPDATE accounts SET granted_scopes = ?2
         WHERE id = ?1 AND granted_scopes IS NOT ?2",
        params![id, sorted.join(" ")],
    )?;
    Ok(changed > 0)
}

/// Records a fresher Google profile: the name and picture it gave, when they
/// differ from what is saved. What it didn't give (or gave empty) is kept as
/// it was, so a refresh that finds less never removes the last good picture.
/// Says whether anything changed.
pub fn set_profile(
    conn: &Connection,
    id: AccountId,
    name: Option<&str>,
    picture: Option<&str>,
) -> Result<bool> {
    let name = name.map(str::trim).filter(|n| !n.is_empty());
    let picture = picture.map(str::trim).filter(|p| !p.is_empty());
    let changed = conn.execute(
        "UPDATE accounts SET display_name = COALESCE(?2, display_name),
                             avatar_url = COALESCE(?3, avatar_url)
         WHERE id = ?1
           AND (COALESCE(?2, display_name) IS NOT display_name
                OR COALESCE(?3, avatar_url) IS NOT avatar_url)",
        params![id, name, picture],
    )?;
    Ok(changed > 0)
}

/// Adds an account, or refreshes its profile if this Google identity is
/// already connected (signing in again must not create a duplicate).
pub fn upsert(conn: &Connection, new: &NewAccount<'_>) -> Result<Account> {
    let existing: Option<AccountId> = conn
        .query_row(
            "SELECT id FROM accounts WHERE google_sub = ?1",
            [new.google_sub],
            |r| r.get(0),
        )
        .optional()?;
    let id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE accounts SET email = ?2, display_name = ?3, avatar_url = ?4, oauth_client = ?5 WHERE id = ?1",
                params![id, new.email, new.display_name, new.avatar_url, new.oauth_client],
            )?;
            id
        }
        None => {
            let color = next_color(conn)?;
            let sort_order: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM accounts",
                [],
                |r| r.get(0),
            )?;
            // Never a removed account's ID (see `MIGRATION_V19`).
            let id: AccountId = conn.query_row(
                "UPDATE account_id_seq
                 SET last = MAX(last, (SELECT COALESCE(MAX(id), 0) FROM accounts)) + 1
                 RETURNING last",
                [],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO accounts (id, google_sub, email, display_name, avatar_url, color, oauth_client, sort_order, created_at)
                 VALUES (?9, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    new.google_sub,
                    new.email,
                    new.display_name,
                    new.avatar_url,
                    color,
                    new.oauth_client,
                    sort_order,
                    now_millis(),
                    id
                ],
            )?;
            conn.execute("INSERT INTO sync_state (account_id) VALUES (?1)", [id])?;
            id
        }
    };
    get(conn, id)
}

fn next_color(conn: &Connection) -> Result<String> {
    let mut stmt = conn.prepare("SELECT color FROM accounts")?;
    let used: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let color = ACCOUNT_COLORS
        .iter()
        .find(|c| !used.iter().any(|u| u == *c))
        .unwrap_or(&ACCOUNT_COLORS[used.len() % ACCOUNT_COLORS.len()]);
    Ok((*color).to_string())
}

pub fn get(conn: &Connection, id: AccountId) -> Result<Account> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM accounts WHERE id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("account {}", id.0)))
}

pub fn list(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM accounts ORDER BY sort_order, id"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn google_sub(conn: &Connection, id: AccountId) -> Result<String> {
    conn.query_row("SELECT google_sub FROM accounts WHERE id = ?1", [id], |r| {
        r.get(0)
    })
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("account {}", id.0)))
}

/// Changes the colour that marks an account's rows. Only colours from
/// `ACCOUNT_COLORS` are accepted (they are picked to read well on glass in
/// light and dark).
pub fn set_color(conn: &Connection, id: AccountId, color: &str) -> Result<Account> {
    let Some(color) = ACCOUNT_COLORS
        .iter()
        .find(|c| c.eq_ignore_ascii_case(color))
    else {
        return Err(CoreError::Invalid(format!("not an account color: {color}")));
    };
    let changed = conn.execute(
        "UPDATE accounts SET color = ?2 WHERE id = ?1",
        params![id, color],
    )?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("account {}", id.0)));
    }
    get(conn, id)
}

/// Removes an account and, through cascading foreign keys, all of its cached
/// mail, and takes back AI apps' access to it, in one transaction. The
/// caller is responsible for deleting its keychain entry.
pub fn remove(conn: &Connection, id: AccountId) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    let mut settings = crate::settings::load(&tx)?;
    let before = settings.mcp.clone();
    settings.mcp.read.retain(|a| *a != id);
    settings.mcp.drafts.retain(|a| *a != id);
    if settings.mcp != before {
        crate::settings::save(&tx, &settings)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn new<'a>(sub: &'a str, email: &'a str) -> NewAccount<'a> {
        NewAccount {
            google_sub: sub,
            email,
            display_name: None,
            avatar_url: None,
            oauth_client: "default",
        }
    }

    #[test]
    fn a_fresher_profile_is_saved_and_what_it_leaves_out_is_kept() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let id = upsert(
            &conn,
            &NewAccount {
                display_name: Some("Ada"),
                avatar_url: Some("https://x.example/old.png"),
                ..new("sub-1", "a@x.example")
            },
        )
        .unwrap()
        .id;
        // A new picture; the name is unchanged.
        assert!(set_profile(&conn, id, Some("Ada"), Some("https://x.example/new.png")).unwrap());
        let a = get(&conn, id).unwrap();
        assert_eq!(a.avatar_url.as_deref(), Some("https://x.example/new.png"));
        assert_eq!(a.display_name.as_deref(), Some("Ada"));
        // The same again: nothing changed.
        assert!(!set_profile(&conn, id, Some("Ada"), Some("https://x.example/new.png")).unwrap());
        // A refresh that finds less (or only blanks) never removes the last good ones.
        assert!(!set_profile(&conn, id, None, None).unwrap());
        assert!(!set_profile(&conn, id, Some("  "), Some("")).unwrap());
        let a = get(&conn, id).unwrap();
        assert_eq!(a.avatar_url.as_deref(), Some("https://x.example/new.png"));
        assert_eq!(a.display_name.as_deref(), Some("Ada"));
        // A new name alone, trimmed.
        assert!(set_profile(&conn, id, Some(" Ada Lovelace "), None).unwrap());
        assert_eq!(
            get(&conn, id).unwrap().display_name.as_deref(),
            Some("Ada Lovelace")
        );
        // An account with no picture yet gets one.
        let bare = upsert(&conn, &new("sub-2", "b@x.example")).unwrap().id;
        assert!(set_profile(&conn, bare, None, Some("https://x.example/b.png")).unwrap());
        assert_eq!(
            get(&conn, bare).unwrap().avatar_url.as_deref(),
            Some("https://x.example/b.png")
        );
        // Only that account.
        assert_eq!(
            get(&conn, id).unwrap().avatar_url.as_deref(),
            Some("https://x.example/new.png")
        );
    }

    /// Regression: SQLite gave a removed account's ID to the next account
    /// added, and AI apps' access, kept by ID, carried over to it.
    #[test]
    fn a_new_account_never_inherits_a_removed_accounts_id_or_access() {
        use crate::settings::{self, McpSettings};
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-a", "a@example.com")).unwrap();
        let mut s = settings::load(&conn).unwrap();
        s.mcp = McpSettings {
            read: vec![a.id],
            drafts: vec![a.id],
        };
        settings::save(&conn, &s).unwrap();

        remove(&conn, a.id).unwrap();
        assert_eq!(settings::load(&conn).unwrap().mcp, McpSettings::default());

        let b = upsert(&conn, &new("sub-b", "b@example.com")).unwrap();
        assert_ne!(a.id, b.id);
        let mcp = settings::load(&conn).unwrap().mcp;
        assert!(!mcp.can_read(b.id) && !mcp.can_draft(b.id));
    }

    #[test]
    fn signing_in_twice_updates_instead_of_duplicating() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-1", "old@example.com")).unwrap();
        let b = upsert(&conn, &new("sub-1", "new@example.com")).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.email, "new@example.com");
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn accounts_get_distinct_colors() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-1", "a@example.com")).unwrap();
        let b = upsert(&conn, &new("sub-2", "b@example.com")).unwrap();
        assert_ne!(a.color, b.color);
    }

    #[test]
    fn color_changes_only_to_a_palette_colour() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-1", "a@example.com")).unwrap();
        let changed = set_color(&conn, a.id, &ACCOUNT_COLORS[3].to_uppercase()).unwrap();
        assert_eq!(changed.color, ACCOUNT_COLORS[3]);
        assert!(matches!(
            set_color(&conn, a.id, "#123456"),
            Err(CoreError::Invalid(_))
        ));
        assert!(matches!(
            set_color(&conn, AccountId(999), ACCOUNT_COLORS[0]),
            Err(CoreError::NotFound(_))
        ));
        assert_eq!(get(&conn, a.id).unwrap().color, ACCOUNT_COLORS[3]);
    }

    #[test]
    fn missing_permissions_follow_what_google_granted() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-1", "a@example.com")).unwrap();
        // Not known yet: every optional permission counts as missing.
        assert_eq!(
            a.missing_permissions,
            vec![
                Permission::Contacts,
                Permission::Calendar,
                Permission::GmailSettings
            ]
        );
        let old = vec![
            "openid".to_string(),
            "https://www.googleapis.com/auth/gmail.modify".into(),
            CONTACTS_SCOPE.into(),
        ];
        assert!(set_granted_scopes(&conn, a.id, &old).unwrap());
        assert!(!set_granted_scopes(&conn, a.id, &old).unwrap());
        assert_eq!(
            get(&conn, a.id).unwrap().missing_permissions,
            vec![Permission::Calendar, Permission::GmailSettings]
        );
        let all = [
            old,
            vec![CALENDAR_SCOPE.into(), GMAIL_SETTINGS_SCOPE.into()],
        ]
        .concat();
        set_granted_scopes(&conn, a.id, &all).unwrap();
        assert!(get(&conn, a.id).unwrap().missing_permissions.is_empty());
    }

    #[test]
    fn calendar_counts_as_granted_with_either_calendar_scope() {
        let with = |calendar: &[&str]| {
            let mut scopes = vec![
                "openid",
                "https://www.googleapis.com/auth/gmail.modify",
                CONTACTS_SCOPE,
                GMAIL_SETTINGS_SCOPE,
            ];
            scopes.extend_from_slice(calendar);
            missing(Some(&scopes.join(" ")))
        };
        // Signed in before the narrower scope: not asked to sign in again.
        assert!(with(&[LEGACY_CALENDAR_SCOPE]).is_empty());
        // Signed in (or refreshed) with only the scope asked for now.
        assert!(with(&[CALENDAR_SCOPE]).is_empty());
        assert!(with(&[CALENDAR_SCOPE, LEGACY_CALENDAR_SCOPE]).is_empty());
        // Neither: only Calendar is missing.
        assert_eq!(with(&[]), vec![Permission::Calendar]);
        // A calendar scope alone grants nothing else.
        assert_eq!(
            missing(Some(LEGACY_CALENDAR_SCOPE)),
            vec![Permission::Contacts, Permission::GmailSettings]
        );
        assert_eq!(
            missing(Some(CALENDAR_SCOPE)),
            vec![Permission::Contacts, Permission::GmailSettings]
        );
        // Close is not enough: scopes match exactly.
        assert_eq!(
            with(&["https://www.googleapis.com/auth/calendar.events.owned.readonly"]),
            vec![Permission::Calendar]
        );
    }

    #[test]
    fn an_account_that_granted_the_old_calendar_scope_keeps_calendar() {
        let db = Db::open_in_memory().unwrap();
        let conn = db.conn();
        let a = upsert(&conn, &new("sub-1", "a@example.com")).unwrap();
        let old = vec![
            "openid".to_string(),
            "https://www.googleapis.com/auth/gmail.modify".into(),
            CONTACTS_SCOPE.into(),
            LEGACY_CALENDAR_SCOPE.into(),
            GMAIL_SETTINGS_SCOPE.into(),
        ];
        set_granted_scopes(&conn, a.id, &old).unwrap();
        assert!(get(&conn, a.id).unwrap().missing_permissions.is_empty());
    }
}
