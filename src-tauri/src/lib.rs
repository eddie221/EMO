pub mod commands;
pub mod db;
pub mod helpers;
pub mod models;

use commands::{
    add_card, delete_card, get_all_cards, get_due_cards, get_settings, get_stats,
    reset_card, review_card, keep_in_box1, save_settings, update_card, save_csv, move_card,
    check_python_env, check_model_cached, setup_python_env, start_meaning_eval, evaluate_meaning, stop_meaning_eval,
};
use commands::{EvalStateInner, MeaningEvalState};
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("emo".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Mutex::new(conn)))
        .manage(MeaningEvalState(Mutex::new(EvalStateInner::Idle)))
        .invoke_handler(tauri::generate_handler![
            get_all_cards, get_due_cards, add_card, update_card,
            delete_card, review_card, keep_in_box1, get_stats, reset_card,
            get_settings, save_settings, save_csv, move_card,
            check_python_env, check_model_cached, setup_python_env, start_meaning_eval,
            evaluate_meaning, stop_meaning_eval,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
