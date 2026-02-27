// §5.11 Global Search — IPC command handler

use crate::search::{self, SearchOptions};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptionsInput {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub max_results: Option<usize>,
    #[serde(default)]
    pub include_glob: Option<String>,
    #[serde(default)]
    pub exclude_glob: Option<String>,
}

#[tauri::command]
pub async fn search_files(
    root_path: String,
    query: String,
    options: Option<SearchOptionsInput>,
) -> Result<Vec<search::SearchResult>, String> {
    let opts = match options {
        Some(input) => SearchOptions {
            case_sensitive: input.case_sensitive,
            whole_word: input.whole_word,
            regex: input.regex,
            max_results: input.max_results.unwrap_or(1000),
            include_glob: input.include_glob,
            exclude_glob: input.exclude_glob,
        },
        None => SearchOptions::default(),
    };

    search::search_files(&root_path, &query, &opts).await
}
