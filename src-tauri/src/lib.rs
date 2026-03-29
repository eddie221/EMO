pub mod commands;
pub mod db;
pub mod helpers;
pub mod models;

use commands::{
    add_card, delete_card, get_all_cards, get_due_cards, get_settings, get_stats,
    reset_card, review_card, keep_in_box1, save_settings, update_card, save_csv, move_card,
};
use db::{init_db, DbState};
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db_path = dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("EMO")
        .join("flashcards.db");
    std::fs::create_dir_all(db_path.parent().unwrap()).expect("Failed to create data directory");
    let conn = rusqlite::Connection::open(&db_path).expect("Failed to open database");
    init_db(&conn).expect("Failed to initialise database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            get_all_cards, get_due_cards, add_card, update_card,
            delete_card, review_card, keep_in_box1, get_stats, reset_card,
            get_settings, save_settings, save_csv, move_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}