use chrono::Local;
use rusqlite::params;
use tauri::State;
use uuid::Uuid;
use std::fs;

use crate::db::DbState;
use crate::helpers::{next_review_date, parse_box_days, row_to_card, SELECT_ALL};
use crate::models::{CreateFlashcard, Flashcard, ReviewResult, Stats};

// ── Settings helpers ─────────────────────────────────────────────────────────

fn load_box_days(conn: &rusqlite::Connection) -> Vec<i64> {
    let raw: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key='box_days'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "1,3,7,14,30".to_string());
    parse_box_days(&raw)
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<DbState>) -> Result<Vec<i64>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    Ok(load_box_days(&conn))
}

#[tauri::command]
pub fn save_settings(state: State<DbState>, box_days: Vec<i64>) -> Result<(), String> {
    if box_days.len() != 5 {
        return Err("box_days must have exactly 5 values".into());
    }
    // enforce strictly increasing
    for i in 1..5 {
        if box_days[i] <= box_days[i - 1] {
            return Err(format!(
                "Box {} interval ({}) must be greater than Box {} ({})",
                i + 1, box_days[i], i, box_days[i - 1]
            ));
        }
    }
    // enforce minimum of 1 day for box 1
    if box_days[0] < 1 {
        return Err("Box 1 interval must be at least 1 day".into());
    }
    let raw = box_days.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(",");
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('box_days', ?1)",
        params![raw],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_all_cards(state: State<DbState>) -> Result<Vec<Flashcard>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(&format!("{} ORDER BY box_number, created_at", SELECT_ALL))
        .map_err(|e| e.to_string())?;
    let cards = stmt.query_map([], |row| row_to_card(row)).map_err(|e| e.to_string())?;
    cards.map(|c| c.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn get_due_cards(state: State<DbState>) -> Result<Vec<Flashcard>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let mut stmt = conn
        .prepare(&format!(
            "{} WHERE next_review <= ?1 ORDER BY box_number ASC, next_review ASC",
            SELECT_ALL
        ))
        .map_err(|e| e.to_string())?;
    let cards = stmt.query_map(params![now], |row| row_to_card(row)).map_err(|e| e.to_string())?;
    cards.map(|c| c.map_err(|e| e.to_string())).collect()
}

#[tauri::command]
pub fn add_card(state: State<DbState>, card: CreateFlashcard) -> Result<Flashcard, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let box_days = load_box_days(&conn);
    let id = Uuid::new_v4().to_string();
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let box_num = card.box_number.unwrap_or(1).clamp(1, 5);
    let next_review = next_review_date(box_num, &box_days);
    conn.execute(
        "INSERT INTO flashcards
         (id, lang1, lang2, description_lang1, part_of_speech,
          example_sentences, usage_frequency, box_number, next_review, created_at, updated_at,
          total_reviews, correct_reviews)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,0)",
        params![
            id, card.lang1, card.lang2, card.description_lang1,
            card.part_of_speech, card.example_sentences, card.usage_frequency,
            box_num, next_review, now, now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(Flashcard {
        id,
        lang1: card.lang1,
        lang2: card.lang2,
        description_lang1: card.description_lang1,
        part_of_speech: card.part_of_speech,
        example_sentences: card.example_sentences,
        usage_frequency: card.usage_frequency,
        box_number: box_num,
        next_review,
        created_at: now.clone(),
        updated_at: now,
        total_reviews: 0,
        correct_reviews: 0,
    })
}

#[tauri::command]
pub fn update_card(
    state: State<DbState>,
    id: String,
    card: CreateFlashcard,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "UPDATE flashcards SET lang1=?1, lang2=?2, description_lang1=?3,
         part_of_speech=?4, example_sentences=?5, usage_frequency=?6, updated_at=?7 WHERE id=?8",
        params![
            card.lang1, card.lang2, card.description_lang1,
            card.part_of_speech, card.example_sentences, card.usage_frequency, now, id
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_card(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM review_log WHERE card_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM flashcards WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn review_card(state: State<DbState>, result: ReviewResult) -> Result<Flashcard, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let box_days = load_box_days(&conn);
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let (current_box, total_reviews, correct_reviews): (i32, i32, i32) = conn
        .query_row(
            "SELECT box_number, total_reviews, correct_reviews FROM flashcards WHERE id=?1",
            params![result.card_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    let new_box = if result.correct { (current_box + 1).min(5) } else { 1 };
    let next_review = next_review_date(new_box, &box_days);
    let new_total   = total_reviews + 1;
    let new_correct = if result.correct { correct_reviews + 1 } else { correct_reviews };

    conn.execute(
        "UPDATE flashcards SET box_number=?1, next_review=?2, updated_at=?3,
         total_reviews=?4, correct_reviews=?5 WHERE id=?6",
        params![new_box, next_review, now, new_total, new_correct, result.card_id],
    )
    .map_err(|e| e.to_string())?;

    let log_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO review_log (id,card_id,correct,box_before,box_after,reviewed_at)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![log_id, result.card_id, result.correct as i32, current_box, new_box, now],
    )
    .map_err(|e| e.to_string())?;

    conn.query_row(
        &format!("{} WHERE id=?1", SELECT_ALL),
        params![result.card_id],
        |row| row_to_card(row),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_stats(state: State<DbState>) -> Result<Stats, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let total_cards: i32 = conn
        .query_row("SELECT COUNT(*) FROM flashcards", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let mut box_counts = Vec::new();
    for b in 1..=5 {
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM flashcards WHERE box_number=?1",
                params![b],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        box_counts.push(count);
    }
    let cards_due_today: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM flashcards WHERE next_review <= ?1",
            params![now],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (total_reviews, correct_reviews): (i32, i32) = conn
        .query_row(
            "SELECT COALESCE(SUM(total_reviews),0), COALESCE(SUM(correct_reviews),0) FROM flashcards",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(Stats { total_cards, box_counts, cards_due_today, total_reviews, correct_reviews })
}

#[tauri::command]
pub fn reset_card(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let box_days = load_box_days(&conn);
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    conn.execute(
        "UPDATE flashcards SET box_number=1, next_review=?1, updated_at=?2 WHERE id=?3",
        params![next_review_date(1, &box_days), now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn move_card(state: State<DbState>, id: String, box_number: i32) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let box_days = load_box_days(&conn);
    let box_num = box_number.clamp(1, 5);
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let next_review = next_review_date(box_num, &box_days);
    conn.execute(
        "UPDATE flashcards SET box_number=?1, next_review=?2, updated_at=?3 WHERE id=?4",
        params![box_num, next_review, now, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_csv(csv: String, filename: String) -> Result<String, String> {
    let dir = dirs_next::download_dir()
        .or_else(|| dirs_next::home_dir())
        .ok_or("Could not find Downloads folder")?;
    let path = dir.join(&filename);
    fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}