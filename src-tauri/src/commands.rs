use chrono::{Duration, Local, NaiveTime, TimeZone};
use log::{debug, error, info, warn};
use rusqlite::params;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};

use crate::db::DbState;
use crate::helpers::{next_review_date, parse_box_days, row_to_card, SELECT_ALL};
use crate::models::{CreateFlashcard, EvalResult, Flashcard, ReviewResult, Stats};

// ── Meaning eval process state ────────────────────────────────────────────────
//
// Ollama-style channel pattern:
//   - A dedicated I/O thread owns all process stdin/stdout handles.
//   - The shared state holds only a SyncSender, so the Mutex is released in
//     microseconds rather than held across blocking I/O.
//   - start_meaning_eval returns immediately; the frontend learns readiness via
//     "eval-ready" / "eval-error" events.

struct EvalRequest {
    word: String,
    description: String,
    user_answer: String,
    resp_tx: mpsc::SyncSender<Result<EvalResult, String>>,
}

pub struct EvalHandle {
    req_tx: mpsc::SyncSender<EvalRequest>,
}

pub enum EvalStateInner {
    Idle,
    Loading,
    Ready(EvalHandle),
    Failed(String),
}

pub struct MeaningEvalState(pub Mutex<EvalStateInner>);

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
pub fn keep_in_box1(state: State<DbState>, card_id: String) -> Result<Flashcard, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let tomorrow = (Local::now() + Duration::days(1)).date_naive();
    let next_review = Local
        .from_local_datetime(&tomorrow.and_time(NaiveTime::from_hms_opt(0, 0, 0).unwrap()))
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%S")
        .to_string();
    conn.execute(
        "UPDATE flashcards SET box_number=1, next_review=?1, updated_at=?2 WHERE id=?3",
        params![next_review, now, card_id],
    )
    .map_err(|e| e.to_string())?;
    conn.query_row(
        &format!("{} WHERE id=?1", SELECT_ALL),
        params![card_id],
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

// ── Meaning mode: Python env + eval process ───────────────────────────────────

const MEANING_EVAL_PY: &str = include_str!("../python/meaning_eval.py");

// Packages passed directly to pip — keeps requirements.txt out of the runtime data dir.
const PIP_PACKAGES: &[&str] = &[
    "transformers>=4.50.0",
    "torch>=2.1.0,<3.0.0",
    "accelerate>=0.26.0",
    "sentencepiece",
    "protobuf",
    "torchvision",
];

fn emo_data_dir() -> std::path::PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("EMO")
}

fn python_bin(venv: &std::path::Path) -> std::path::PathBuf {
    if cfg!(target_os = "windows") {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python3")
    }
}

/// Returns (major, minor) for a Python executable, or None if it can't be determined.
fn python_version(path: &std::path::Path) -> Option<(u32, u32)> {
    let out = Command::new(path)
        .args(["-c", "import sys; print(sys.version_info.major, sys.version_info.minor)"])
        .output()
        .ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    let mut parts = s.split_whitespace();
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// Returns true if the Python version is compatible with PyTorch (3.9 – 3.13).
fn python_version_ok(major: u32, minor: u32) -> bool {
    major == 3 && minor >= 9 && minor <= 13
}

/// Finds a working python3 executable compatible with PyTorch (3.9–3.13).
/// GUI apps on macOS/Linux don't inherit the shell PATH, so $PATH-based lookup
/// misses Homebrew (/opt/homebrew/bin, /usr/local/bin) and pyenv installs.
fn find_python3() -> Result<std::path::PathBuf, String> {
    let candidates: &[&str] = if cfg!(target_os = "windows") {
        &["python3.13", "python3.12", "python3.11", "python3.10", "python3.9", "python3", "python"]
    } else {
        &[
            // Versioned Homebrew binaries — prefer newer-but-compatible
            "/opt/homebrew/bin/python3.13",
            "/opt/homebrew/bin/python3.12",
            "/opt/homebrew/bin/python3.11",
            "/usr/local/bin/python3.13",
            "/usr/local/bin/python3.12",
            "/usr/local/bin/python3.11",
            // Unversioned symlinks (may point to 3.14+ on bleeding-edge systems)
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
            "python3",
        ]
    };

    let mut incompatible: Option<(std::path::PathBuf, u32, u32)> = None;

    for candidate in candidates {
        let path = std::path::PathBuf::from(candidate);
        if let Some((major, minor)) = python_version(&path) {
            if python_version_ok(major, minor) {
                info!("find_python3: using {candidate} (Python {major}.{minor})");
                return Ok(path);
            }
            debug!("find_python3: {candidate} is Python {major}.{minor} — incompatible with PyTorch");
            if incompatible.is_none() {
                incompatible = Some((path, major, minor));
            }
        } else {
            debug!("find_python3: not found at {candidate}");
        }
    }

    if let Some((_, major, minor)) = incompatible {
        error!("find_python3: only found Python {major}.{minor}, which is not supported by PyTorch");
        Err(format!(
            "Python {major}.{minor} is not supported by PyTorch (requires 3.9–3.13). \
             Please install Python 3.12 via Homebrew: brew install python@3.12"
        ))
    } else {
        error!("find_python3: python3 not found in any candidate location");
        Err("Python 3 not found. Please install Python 3.12 via Homebrew: brew install python@3.12".into())
    }
}

/// Returns true if the model snapshot directory exists and is non-empty.
fn is_model_cached(model_id: &str) -> bool {
    // HF stores models at $HF_HOME/hub/models--<org>--<name>/snapshots/<hash>/
    let hf_home = std::env::var("HF_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            dirs_next::home_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join(".cache")
                .join("huggingface")
        });
    let model_dir = hf_home
        .join("hub")
        .join(format!("models--{}", model_id.replace('/', "--")));
    let snapshots = model_dir.join("snapshots");
    let cached = snapshots.is_dir()
        && fs::read_dir(&snapshots)
            .ok()
            .and_then(|mut d| d.next())
            .is_some();
    info!("is_model_cached({model_id}): {cached} (checked {})", snapshots.display());
    cached
}

/// Returns true if the EMO venv exists and the transformers package is present.
/// Uses filesystem checks only — no subprocess spawning — so it returns instantly.
#[tauri::command]
pub fn check_python_env() -> bool {
    let venv = emo_data_dir().join("EMO");
    if !python_bin(&venv).exists() {
        info!("check_python_env: venv python binary not found at {}", python_bin(&venv).display());
        return false;
    }

    // Locate site-packages and check for the transformers directory
    let site_packages = if cfg!(target_os = "windows") {
        venv.join("Lib").join("site-packages")
    } else {
        // lib/pythonX.Y/site-packages — glob the pythonX.Y dir
        let lib = venv.join("lib");
        match fs::read_dir(&lib).ok().and_then(|mut d| d.find_map(|e| e.ok())) {
            Some(entry) => entry.path().join("site-packages"),
            None => {
                warn!("check_python_env: could not read venv/lib directory");
                return false;
            }
        }
    };

    let ready = site_packages.join("transformers").is_dir();
    info!("check_python_env: transformers present = {ready}");
    ready
}

/// Returns true if both the venv and the model cache are present.
/// This is the single check the frontend uses to decide whether setup is needed.
#[tauri::command]
pub fn check_model_cached() -> bool {
    let venv_ok = check_python_env();
    let model_ok = is_model_cached("google/gemma-3-1b-it");
    info!("check_model_cached: venv={venv_ok} model={model_ok}");
    venv_ok && model_ok
}

/// Streams stdout and stderr from a child process concurrently, emitting each line
/// as a "setup-log" event. stderr is drained in a background thread so neither
/// pipe stalls waiting for the other to be read.
fn stream_child(proc: &mut std::process::Child, app: &tauri::AppHandle) {
    let stderr = proc.stderr.take().map(BufReader::new);
    let app2 = app.clone();
    let stderr_thread = stderr.map(|reader| {
        std::thread::spawn(move || {
            for line in reader.lines().flatten() {
                debug!("setup stderr: {line}");
                app2.emit("setup-log", line).ok();
            }
        })
    });

    if let Some(stdout) = proc.stdout.take() {
        for line in BufReader::new(stdout).lines().flatten() {
            debug!("setup stdout: {line}");
            app.emit("setup-log", line).ok();
        }
    }

    if let Some(t) = stderr_thread {
        t.join().ok();
    }
}

fn run_setup(app: &tauri::AppHandle, hf_token: Option<String>, force_redownload: bool) -> Result<(), String> {
    let emit = |msg: &str| { app.emit("setup-log", msg.to_string()).ok(); };

    let data = emo_data_dir();
    info!("run_setup: data dir = {}", data.display());
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;

    let venv = data.join("EMO");

    // 1. Create venv (skip if already exists)
    if !python_bin(&venv).exists() {
        emit("[1/3] Creating virtual environment 'EMO'…");
        let python3 = find_python3()?;
        emit(&format!("Using {}", python3.display()));
        info!("run_setup: creating venv at {} using {}", venv.display(), python3.display());
        let out = Command::new(&python3)
            .args(["-m", "venv", venv.to_str().unwrap()])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr).into_owned();
            error!("run_setup: venv creation failed: {msg}");
            emit(&format!("Error: {msg}"));
            return Err(msg);
        }
        info!("run_setup: venv created");
        emit("Virtual environment created.");
    } else {
        info!("run_setup: venv already exists, skipping creation");
    }

    let python = python_bin(&venv);
    let pip = if cfg!(target_os = "windows") {
        venv.join("Scripts").join("pip.exe")
    } else {
        venv.join("bin").join("pip3")
    };

    // 2. Install packages inline — no requirements.txt file needed at runtime
    emit("[2/3] Installing Python packages…");
    info!("run_setup: running pip install");
    let mut pip_args = vec!["install", "--progress-bar", "on"];
    pip_args.extend(PIP_PACKAGES.iter().copied());
    let mut proc = Command::new(&pip)
        .args(&pip_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    stream_child(&mut proc, app);

    let pip_status = proc.wait().map_err(|e| e.to_string())?;
    if !pip_status.success() {
        error!("run_setup: pip install failed with exit code {:?}", pip_status.code());
        return Err("pip install failed".into());
    }
    info!("run_setup: pip install succeeded");

    // 3. Pre-download the model weights (skip if already cached, unless forced)
    if !force_redownload && is_model_cached("google/gemma-3-1b-it") {
        info!("run_setup: model already cached, skipping download");
        emit("[3/3] Model already downloaded, skipping.");
        emit("Setup complete!");
        return Ok(());
    }
    if force_redownload {
        info!("run_setup: force_redownload=true, re-downloading model");
        emit("[3/3] Re-downloading google/gemma-3-1b-it…");
    } else {
        emit("[3/3] Downloading google/gemma-3-1b-it…");
    }
    info!("run_setup: starting model download");
    let dl_script = "\
from transformers import AutoModelForCausalLM, AutoTokenizer
print('Downloading tokenizer…', flush=True)
AutoTokenizer.from_pretrained('google/gemma-3-1b-it')
print('Downloading model weights…', flush=True)
AutoModelForCausalLM.from_pretrained('google/gemma-3-1b-it')
print('Download complete.', flush=True)
";

    let mut cmd = Command::new(&python);
    cmd.args(["-u", "-c", dl_script])
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(ref token) = hf_token {
        cmd.env("HF_TOKEN", token);
    }
    let mut proc = cmd.spawn().map_err(|e| e.to_string())?;

    stream_child(&mut proc, app);

    let dl_status = proc.wait().map_err(|e| e.to_string())?;
    if !dl_status.success() {
        error!("run_setup: model download failed with exit code {:?}", dl_status.code());
        return Err("Model download failed".into());
    }
    info!("run_setup: model download succeeded");

    emit("Setup complete!");
    Ok(())
}

/// Starts the setup in a background thread and returns immediately.
/// Listen for "setup-log" events for progress, "setup-done" on success,
/// and "setup-error" on failure.
#[tauri::command]
pub fn setup_python_env(app: tauri::AppHandle, hf_token: Option<String>, force_redownload: bool) -> Result<(), String> {
    info!("setup_python_env: spawning setup thread");
    std::thread::spawn(move || {
        match run_setup(&app, hf_token, force_redownload) {
            Ok(()) => {
                info!("setup_python_env: setup completed successfully");
                app.emit("setup-done", ()).ok();
            }
            Err(e) => {
                error!("setup_python_env: setup failed: {e}");
                app.emit("setup-error", e).ok();
            }
        }
    });
    Ok(())
}

/// Spawns the Python process and an I/O handler thread.
/// Returns an EvalHandle (channel sender) once "ready" is received, or an error.
fn spawn_eval_process(app: &tauri::AppHandle) -> Result<EvalHandle, String> {
    let data   = emo_data_dir();
    let venv   = data.join("EMO");
    let python = python_bin(&venv);
    let script = data.join("meaning_eval.py");

    // Always write the embedded script so it exists on a fresh install and
    // stays up to date after app upgrades.
    fs::write(&script, MEANING_EVAL_PY).map_err(|e| format!("Failed to write eval script: {e}"))?;
    info!("spawn_eval_process: starting {} {}", python.display(), script.display());

    let mut child = Command::new(&python)
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start eval process: {e}"))?;

    info!("spawn_eval_process: process spawned (pid {:?})", child.id());

    let mut stdin  = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let stderr     = child.stderr.take().unwrap();

    // Drain stderr in a background thread and forward lines as events.
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            debug!("eval stderr: {line}");
            app_err.emit("eval-log", format!("[stderr] {line}")).ok();
        }
    });

    // Block *this* (background) thread until Python signals ready.
    info!("spawn_eval_process: waiting for ready signal…");
    let mut line = String::new();
    stdout.read_line(&mut line).map_err(|e| e.to_string())?;
    if line.is_empty() {
        error!("spawn_eval_process: process exited before signaling ready");
        return Err("Python process exited before signaling ready".into());
    }
    let val: serde_json::Value = serde_json::from_str(line.trim())
        .map_err(|_| format!("Invalid ready signal: {}", line.trim()))?;
    if let Some(err) = val.get("error") {
        let msg = err.as_str().unwrap_or("unknown error").to_string();
        error!("spawn_eval_process: model load error: {msg}");
        return Err(msg);
    }
    info!("spawn_eval_process: model ready");

    // Hand off all I/O to a dedicated thread. The mutex is never held across I/O.
    let (req_tx, req_rx) = mpsc::sync_channel::<EvalRequest>(1);
    std::thread::spawn(move || {
        for req in req_rx {
            debug!("eval_io_thread: evaluating word={:?}", req.word);
            let result = (|| -> Result<EvalResult, String> {
                let json = serde_json::json!({
                    "word": req.word,
                    "description": req.description,
                    "user_answer": req.user_answer,
                });
                writeln!(stdin, "{json}").map_err(|e| e.to_string())?;
                stdin.flush().map_err(|e| e.to_string())?;

                let mut response = String::new();
                stdout.read_line(&mut response).map_err(|e| e.to_string())?;
                if response.is_empty() {
                    error!("eval_io_thread: Python process closed unexpectedly");
                    return Err("Python process closed unexpectedly".into());
                }

                let val: serde_json::Value = serde_json::from_str(response.trim())
                    .map_err(|e| e.to_string())?;
                if let Some(err) = val.get("error") {
                    let msg = err.as_str().unwrap_or("eval error").to_string();
                    error!("eval_io_thread: eval error from Python: {msg}");
                    return Err(msg);
                }
                let result = EvalResult {
                    correct:  val["correct"].as_bool().unwrap_or(false),
                    feedback: val["feedback"].as_str().unwrap_or("").to_string(),
                };
                debug!("eval_io_thread: result correct={}", result.correct);
                Ok(result)
            })();
            req.resp_tx.send(result).ok();
        }
        info!("eval_io_thread: channel closed, killing process");
        child.kill().ok();
    });

    Ok(EvalHandle { req_tx })
}

/// Starts the Python eval process in the background.
/// Returns immediately; listen for "eval-ready" / "eval-error" events on the window.
#[tauri::command]
pub fn start_meaning_eval(app: tauri::AppHandle) -> Result<(), String> {
    {
        let state = app.state::<MeaningEvalState>();
        let mut lock = state.0.lock().map_err(|e| e.to_string())?;
        match &*lock {
            EvalStateInner::Loading | EvalStateInner::Ready(_) => {
                info!("start_meaning_eval: already loading or ready, skipping");
                return Ok(());
            }
            _ => {}
        }
        info!("start_meaning_eval: beginning model load");
        *lock = EvalStateInner::Loading;
    } // mutex released before spawning

    std::thread::spawn(move || {
        let state = app.state::<MeaningEvalState>();
        match spawn_eval_process(&app) {
            Ok(handle) => {
                info!("start_meaning_eval: model ready, updating state");
                *state.0.lock().unwrap() = EvalStateInner::Ready(handle);
                app.emit("eval-ready", ()).ok();
            }
            Err(e) => {
                error!("start_meaning_eval: failed to load model: {e}");
                *state.0.lock().unwrap() = EvalStateInner::Failed(e.clone());
                app.emit("eval-error", e).ok();
            }
        }
    });

    Ok(())
}

/// Sends a request to the Python process. Does not hold the mutex during inference.
#[tauri::command]
pub fn evaluate_meaning(
    state: State<MeaningEvalState>,
    word: String,
    description: String,
    user_answer: String,
) -> Result<EvalResult, String> {
    debug!("evaluate_meaning: word={word:?}");
    // Hold mutex only long enough to clone the sender.
    let req_tx = {
        let lock = state.0.lock().map_err(|e| e.to_string())?;
        match &*lock {
            EvalStateInner::Ready(h)  => h.req_tx.clone(),
            EvalStateInner::Loading   => {
                warn!("evaluate_meaning: called while model still loading");
                return Err("Model is still loading".into());
            }
            EvalStateInner::Failed(e) => {
                error!("evaluate_meaning: called but model failed: {e}");
                return Err(e.clone());
            }
            EvalStateInner::Idle => {
                warn!("evaluate_meaning: called before start_meaning_eval");
                return Err("Eval process not started".into());
            }
        }
    };

    let (resp_tx, resp_rx) = mpsc::sync_channel(1);
    req_tx.send(EvalRequest { word, description, user_answer, resp_tx })
        .map_err(|_| "Eval process is not available".to_string())?;
    let result = resp_rx.recv().map_err(|_| "Eval process closed unexpectedly".to_string())?;
    if let Ok(ref r) = result {
        debug!("evaluate_meaning: result correct={}", r.correct);
    }
    result
}

/// Stops the Python eval process by dropping the channel (I/O thread kills the child).
#[tauri::command]
pub fn stop_meaning_eval(state: State<MeaningEvalState>) -> Result<(), String> {
    info!("stop_meaning_eval: stopping eval process");
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    *lock = EvalStateInner::Idle;
    Ok(())
}