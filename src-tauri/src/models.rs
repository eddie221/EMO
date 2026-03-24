use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Flashcard {
    pub id: String,
    pub lang1: String,
    pub lang2: String,
    pub description_lang1: String,
    pub part_of_speech: String,
    pub example_sentences: String,
    pub usage_frequency: String,
    pub box_number: i32,
    pub next_review: String,
    pub created_at: String,
    pub updated_at: String,
    pub total_reviews: i32,
    pub correct_reviews: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFlashcard {
    pub lang1: String,
    pub lang2: String,
    pub description_lang1: String,
    pub part_of_speech: String,
    pub example_sentences: String,
    pub usage_frequency: String,
    #[serde(default)]
    pub box_number: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReviewResult {
    pub card_id: String,
    pub correct: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Stats {
    pub total_cards: i32,
    pub box_counts: Vec<i32>,
    pub cards_due_today: i32,
    pub total_reviews: i32,
    pub correct_reviews: i32,
}