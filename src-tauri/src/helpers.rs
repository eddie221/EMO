use chrono::Local;
use rusqlite::{params, Connection};

pub const SELECT_ALL: &str =
    "SELECT id, lang1, lang2, description_lang1,
    part_of_speech, example_sentences, usage_frequency, box_number, next_review_day, language,
    created_at, updated_at, total_reviews, correct_reviews FROM flashcards";

/// Parse the "box_days" setting string (e.g. "1,3,7,14,30") into a Vec<i64>.
/// Falls back to defaults if malformed.
pub fn parse_box_days(raw: &str) -> Vec<i64> {
    let parsed: Vec<i64> = raw
        .split(',')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect();
    if parsed.len() == 5 {
        parsed
    } else {
        vec![1, 3, 7, 14, 30]
    }
}

/// Sentinel "study day" for Box 6 cards: they're drawn by daily lottery, never due.
pub const NEVER_DUE: i64 = 999_999_999;

/// Study days are counted by days the app is actually used, not calendar days.
/// The counter advances by one the first time the app is touched on a new
/// calendar date, so a 3-day interval means "3 days of use later".
pub fn current_study_day(conn: &Connection) -> i64 {
    let get = |key: &str| -> Option<String> {
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| r.get(0)).ok()
    };
    let mut day: i64 = get("study_day").and_then(|v| v.parse().ok()).unwrap_or(1);
    let today = Local::now().format("%Y-%m-%d").to_string();
    if get("last_active_date").as_deref() != Some(today.as_str()) {
        // First run ever (no recorded date) stays on the current day.
        if get("last_active_date").is_some() {
            day += 1;
        }
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('study_day', ?1)",
            params![day.to_string()],
        );
        let _ = conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('last_active_date', ?1)",
            params![today],
        );
    }
    day
}

/// Study day on which a card in `box_number` (1-based) is next due.
pub fn next_review_day(box_number: i32, box_days: &[i64], today: i64) -> i64 {
    if box_number == 6 {
        return NEVER_DUE;
    }
    let days = if box_number == 1 {
        0
    } else {
        box_days.get((box_number - 1) as usize).copied().unwrap_or(1)
    };
    today + days
}

pub fn row_to_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<crate::models::Flashcard> {
    Ok(crate::models::Flashcard {
        id:                row.get(0)?,
        lang1:             row.get(1)?,
        lang2:             row.get(2)?,
        description_lang1: row.get(3)?,
        part_of_speech:    row.get(4)?,
        example_sentences: row.get(5)?,
        usage_frequency:   row.get(6)?,
        box_number:        row.get(7)?,
        next_review_day:   row.get(8)?,
        language:          row.get(9)?,
        created_at:        row.get(10)?,
        updated_at:        row.get(11)?,
        total_reviews:     row.get(12)?,
        correct_reviews:   row.get(13)?,
    })
}