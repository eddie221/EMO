use chrono::{Duration, Utc};

pub const SELECT_ALL: &str =
    "SELECT id, lang1, lang2, description_lang1,
    part_of_speech, example_sentences, usage_frequency, box_number, next_review,
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

/// Compute the next review date given the box number (1-based) and the
/// resolved interval list.
pub fn next_review_date(box_number: i32, box_days: &[i64]) -> String {
    if box_number == 1 {
        return Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    }
    let days = box_days
        .get((box_number - 1) as usize)
        .copied()
        .unwrap_or(1);
    (Utc::now() + Duration::days(days))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
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
        next_review:       row.get(8)?,
        created_at:        row.get(9)?,
        updated_at:        row.get(10)?,
        total_reviews:     row.get(11)?,
        correct_reviews:   row.get(12)?,
    })
}