use rusqlite::{Connection, Result as SqlResult};
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn init_db(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS flashcards (
            id                TEXT PRIMARY KEY,
            lang1             TEXT NOT NULL,
            lang2             TEXT NOT NULL,
            description_lang1 TEXT NOT NULL DEFAULT '',
            part_of_speech    TEXT NOT NULL DEFAULT '',
            example_sentences TEXT NOT NULL DEFAULT '',
            usage_frequency   TEXT NOT NULL DEFAULT 'common',
            box_number        INTEGER NOT NULL DEFAULT 1,
            next_review_day   INTEGER NOT NULL DEFAULT 1,
            language          TEXT NOT NULL DEFAULT 'English',
            created_at        TEXT NOT NULL,
            updated_at        TEXT NOT NULL,
            total_reviews     INTEGER NOT NULL DEFAULT 0,
            correct_reviews   INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS review_log (
            id          TEXT PRIMARY KEY,
            card_id     TEXT NOT NULL,
            correct     INTEGER NOT NULL,
            box_before  INTEGER NOT NULL,
            box_after   INTEGER NOT NULL,
            reviewed_at TEXT NOT NULL,
            FOREIGN KEY (card_id) REFERENCES flashcards(id)
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO settings (key, value) VALUES ('box_days', '1,3,7,14,30');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('box6_count', '5');
        INSERT OR IGNORE INTO settings (key, value) VALUES ('study_day', '1');
    ")?;
    migrate(conn)?;
    Ok(())
}

fn has_column(conn: &Connection, table: &str, col: &str) -> SqlResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let found = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|name| name == col);
    Ok(found)
}

/// Upgrade databases created before languages / study-day scheduling existed.
fn migrate(conn: &Connection) -> SqlResult<()> {
    if !has_column(conn, "flashcards", "language")? {
        conn.execute(
            "ALTER TABLE flashcards ADD COLUMN language TEXT NOT NULL DEFAULT 'English'",
            [],
        )?;
    }
    if has_column(conn, "flashcards", "next_review")? {
        // Old schema: calendar-date due times. Convert to study days, treating
        // today as the current study day and keeping the remaining gap.
        if !has_column(conn, "flashcards", "next_review_day")? {
            conn.execute(
                "ALTER TABLE flashcards ADD COLUMN next_review_day INTEGER NOT NULL DEFAULT 1",
                [],
            )?;
        }
        conn.execute_batch(
            "UPDATE flashcards SET next_review_day = CASE
                 WHEN next_review LIKE '9999%' THEN 999999999
                 ELSE (SELECT CAST(value AS INTEGER) FROM settings WHERE key='study_day')
                      + MAX(0, CAST(julianday(substr(next_review,1,10))
                                    - julianday(date('now','localtime')) AS INTEGER))
             END;
             ALTER TABLE flashcards DROP COLUMN next_review;",
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_old_schema_to_study_days() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE flashcards (
                id TEXT PRIMARY KEY, lang1 TEXT NOT NULL, lang2 TEXT NOT NULL,
                description_lang1 TEXT NOT NULL DEFAULT '', part_of_speech TEXT NOT NULL DEFAULT '',
                example_sentences TEXT NOT NULL DEFAULT '', usage_frequency TEXT NOT NULL DEFAULT 'common',
                box_number INTEGER NOT NULL DEFAULT 1, next_review TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                total_reviews INTEGER NOT NULL DEFAULT 0, correct_reviews INTEGER NOT NULL DEFAULT 0);
            INSERT INTO flashcards (id,lang1,lang2,box_number,next_review,created_at,updated_at)
              VALUES ('a','x','y',6,'9999-12-31T00:00:00','',''),
                     ('b','x','y',1,'2000-01-01T00:00:00','',''),
                     ('c','x','y',3,'2999-01-10T00:00:00','','');
        ").unwrap();
        init_db(&conn).unwrap();
        let get = |id: &str| -> (i64, String) {
            conn.query_row("SELECT next_review_day, language FROM flashcards WHERE id=?1", [id],
                |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(get("a").0, 999_999_999);
        assert_eq!(get("b"), (1, "English".to_string()));
        assert!(get("c").0 > 1000);
        assert!(!has_column(&conn, "flashcards", "next_review").unwrap());
    }
}
