//! "Delete all data": empties the database but for its own
//! bookkeeping. Every table is emptied, found in the database itself, so a
//! table added later is erased too, with nothing here to forget.

use rusqlite::Connection;

use crate::error::Result;

/// Kept: what makes the database work, not data. The migrations record which
/// steps ran, and the ID counter keeps an erased account's ID from being given
/// out again (a leftover of it somewhere can then never be taken for a new
/// account's).
const KEPT: [&str; 2] = ["schema_migrations", "account_id_seq"];

/// Empties every table except `KEPT`: accounts and, with them, their mail,
/// then settings, per-sender choices, summaries, usage history and the rest.
/// One transaction: all of it, or none. The accounts' tokens and files are
/// the caller's, done before this.
pub fn erase_all(conn: &mut Connection) -> Result<()> {
    let tables = erasable_tables(conn)?;
    let tx = conn.transaction()?;
    // Parents first or not, a child row may briefly point at a deleted
    // parent: check at the end.
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")?;
    // Accounts first: their rows in other tables go with them (ON DELETE
    // CASCADE), which is quicker than counting them out one table at a time.
    tx.execute("DELETE FROM accounts", [])?;
    for table in tables {
        tx.execute(&format!("DELETE FROM \"{table}\""), [])?;
    }
    tx.commit()?;
    // Hand the space back to the disk.
    conn.execute_batch("VACUUM")?;
    Ok(())
}

/// The tables to empty: all but `KEPT` and SQLite's own, with the search
/// index (a virtual table) counted in and its shadow tables left out: SQLite
/// says which tables are shadows, and they must not be touched directly. A
/// table that merely has a similar name is data like any other.
fn erasable_tables(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM pragma_table_list
         WHERE schema = 'main' AND type IN ('table', 'virtual') AND name NOT LIKE 'sqlite_%'",
    )?;
    let all: Vec<String> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(all
        .into_iter()
        .filter(|name| !KEPT.contains(&name.as_str()))
        .collect())
}
