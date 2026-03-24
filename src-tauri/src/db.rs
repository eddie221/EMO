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
            next_review       TEXT NOT NULL,
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
    ")?;
    Ok(())
}