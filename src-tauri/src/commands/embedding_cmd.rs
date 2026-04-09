// §11.4 Embedding IPC commands — embed_text, search_knowledge, index_vault, index_status, index_file

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::command;
use tokio::sync::Mutex;

use crate::embedding::chunker::{chunk_markdown, Chunk};
use crate::embedding::hybrid_ranker::{self, RankedChunk};
use crate::embedding::vector_store::VectorStore;
use crate::embedding::EmbedConfig;

/// Managed state for the embedding system.
pub struct EmbeddingState {
    pub vector_store: Arc<Mutex<VectorStore>>,
    pub chunk_index: Arc<Mutex<HashMap<String, Chunk>>>,
    pub is_indexing: Arc<Mutex<bool>>,
}

impl EmbeddingState {
    pub fn new() -> Self {
        Self {
            vector_store: Arc::new(Mutex::new(VectorStore::new())),
            chunk_index: Arc::new(Mutex::new(HashMap::new())),
            is_indexing: Arc::new(Mutex::new(false)),
        }
    }
}

/// Status of the embedding index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexStatus {
    pub total_files: usize,
    pub indexed_files: usize,
    pub total_chunks: usize,
    pub is_indexing: bool,
}

/// Embed a single text and return the embedding vector.
#[command]
pub async fn embed_text(
    text: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<f32>, String> {
    let client = reqwest::Client::new();
    let config = EmbedConfig {
        model,
        api_key,
        base_url,
    };
    let results = crate::embedding::embed_texts(&client, vec![text], &provider, &config)
        .await
        .map_err(|e| e.to_string())?;
    results
        .into_iter()
        .next()
        .ok_or_else(|| "No embedding returned".to_string())
}

/// Search the knowledge base using hybrid ranking (BM25 + vector + graph).
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn search_knowledge(
    state: tauri::State<'_, EmbeddingState>,
    link_state: tauri::State<'_, super::index_cmd::LinkIndexState>,
    ctx_mgr: tauri::State<'_, crate::context::ContextManager>,
    query: String,
    top_k: Option<usize>,
    current_file: Option<String>,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<SearchResultPayload>, String> {
    let k = top_k.unwrap_or(5);
    let client = reqwest::Client::new();
    let config = EmbedConfig {
        model,
        api_key,
        base_url,
    };

    // Embed the query
    let query_embeddings =
        crate::embedding::embed_texts(&client, vec![query.clone()], &provider, &config)
            .await
            .map_err(|e| e.to_string())?;

    let query_vec = query_embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "No query embedding returned".to_string())?;

    // Vector search — fetch more candidates for re-ranking
    let candidate_k = (k * 3).max(15);
    let store = state.vector_store.lock().await;
    let vector_results = store.search(&query_vec, candidate_k);
    drop(store);

    if vector_results.is_empty() {
        return Ok(vec![]);
    }

    // Build data structures for hybrid ranking
    let chunk_index = state.chunk_index.lock().await;

    let mut ranked_chunks: Vec<RankedChunk> = Vec::new();
    let mut vector_scores: Vec<f32> = Vec::new();
    let mut chunk_contents: HashMap<String, String> = HashMap::new();

    for result in &vector_results {
        if let Some(chunk) = chunk_index.get(&result.id) {
            ranked_chunks.push(RankedChunk {
                id: result.id.clone(),
                file_path: chunk.file_path.clone(),
                score: result.score,
            });
            vector_scores.push(result.score);
            chunk_contents.insert(result.id.clone(), chunk.content.clone());
        }
    }
    drop(chunk_index);

    // Build outgoing link map from LinkIndex for graph proximity
    let outgoing = {
        let key = ctx_mgr.active_id().await.unwrap_or_default();
        let map = link_state.0.lock().await;
        let graph = map
            .get(&key)
            .map(|idx| idx.get_link_graph())
            .unwrap_or_default();
        let mut out_map: HashMap<String, Vec<String>> = HashMap::new();
        for edge in &graph.edges {
            out_map
                .entry(edge.from.clone())
                .or_default()
                .push(edge.to.clone());
        }
        out_map
    };

    // Apply hybrid ranking: BM25 + vector + graph → combined score → diversity
    let final_results = hybrid_ranker::hybrid_rank(
        &query,
        ranked_chunks,
        &vector_scores,
        &chunk_contents,
        current_file.as_deref(),
        &outgoing,
        k,
    );

    // Build response payloads
    let chunk_index = state.chunk_index.lock().await;
    let mut payloads = Vec::new();
    for result in final_results {
        if let Some(chunk) = chunk_index.get(&result.id) {
            payloads.push(SearchResultPayload {
                chunk_id: result.id,
                file_path: chunk.file_path.clone(),
                heading_path: chunk.heading_path.clone(),
                content: chunk.content.clone(),
                score: result.score,
            });
        }
    }

    Ok(payloads)
}

/// Search result payload for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultPayload {
    pub chunk_id: String,
    pub file_path: String,
    pub heading_path: Vec<String>,
    pub content: String,
    pub score: f32,
}

/// Index an entire vault directory.
#[command]
pub async fn index_vault(
    state: tauri::State<'_, EmbeddingState>,
    vault_path: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<IndexStatus, String> {
    // Set indexing flag
    {
        let mut indexing = state.is_indexing.lock().await;
        if *indexing {
            return Err("Indexing is already in progress".to_string());
        }
        *indexing = true;
    }

    let config = EmbedConfig {
        model,
        api_key,
        base_url,
    };
    let client = reqwest::Client::new();

    // Collect markdown files
    let md_files = collect_markdown_files(&vault_path).map_err(|e| e.to_string())?;
    let total_files = md_files.len();
    let mut indexed_files = 0;
    let mut total_chunks = 0;

    for file_path in &md_files {
        let relative_path = file_path
            .strip_prefix(&vault_path)
            .unwrap_or(file_path)
            .trim_start_matches('/')
            .to_string();

        match index_single_file(
            &state,
            &client,
            file_path,
            &relative_path,
            &provider,
            &config,
        )
        .await
        {
            Ok(chunk_count) => {
                indexed_files += 1;
                total_chunks += chunk_count;
            }
            Err(e) => {
                eprintln!("Failed to index {}: {}", file_path, e);
            }
        }
    }

    // Clear indexing flag
    {
        let mut indexing = state.is_indexing.lock().await;
        *indexing = false;
    }

    Ok(IndexStatus {
        total_files,
        indexed_files,
        total_chunks,
        is_indexing: false,
    })
}

/// Get the current index status.
#[command]
pub async fn index_status(state: tauri::State<'_, EmbeddingState>) -> Result<IndexStatus, String> {
    let store = state.vector_store.lock().await;
    let chunk_index = state.chunk_index.lock().await;
    let is_indexing = *state.is_indexing.lock().await;

    // Count unique files from chunk index
    let mut files: std::collections::HashSet<String> = std::collections::HashSet::new();
    for chunk in chunk_index.values() {
        files.insert(chunk.file_path.clone());
    }

    Ok(IndexStatus {
        total_files: files.len(),
        indexed_files: files.len(),
        total_chunks: store.len(),
        is_indexing,
    })
}

/// Index a single file (incremental update).
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn index_file(
    state: tauri::State<'_, EmbeddingState>,
    file_path: String,
    relative_path: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<usize, String> {
    let config = EmbedConfig {
        model,
        api_key,
        base_url,
    };
    let client = reqwest::Client::new();

    index_single_file(
        &state,
        &client,
        &file_path,
        &relative_path,
        &provider,
        &config,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Internal helper to index a single file.
async fn index_single_file(
    state: &tauri::State<'_, EmbeddingState>,
    client: &reqwest::Client,
    file_path: &str,
    relative_path: &str,
    provider: &str,
    config: &EmbedConfig,
) -> Result<usize, String> {
    // Read file content
    let content = tokio::fs::read_to_string(file_path)
        .await
        .map_err(|e| e.to_string())?;

    // Remove old entries for this file
    {
        let mut store = state.vector_store.lock().await;
        store.remove_by_file(relative_path);
    }
    {
        let mut chunk_index = state.chunk_index.lock().await;
        chunk_index.retain(|_, chunk| chunk.file_path != relative_path);
    }

    // Chunk the markdown
    let chunks = chunk_markdown(&content, relative_path);
    if chunks.is_empty() {
        return Ok(0);
    }

    // Embed all chunks
    let texts: Vec<String> = chunks.iter().map(|c| c.content.clone()).collect();
    let embeddings = crate::embedding::embed_texts(client, texts, provider, config)
        .await
        .map_err(|e| e.to_string())?;

    // Store embeddings and chunks
    let mut store = state.vector_store.lock().await;
    let mut chunk_index = state.chunk_index.lock().await;
    let chunk_count = chunks.len();

    for (chunk, embedding) in chunks.into_iter().zip(embeddings.into_iter()) {
        store.add_with_file(&chunk.id, embedding, relative_path);
        chunk_index.insert(chunk.id.clone(), chunk);
    }

    Ok(chunk_count)
}

/// Collect all markdown files from a directory recursively.
fn collect_markdown_files(dir: &str) -> Result<Vec<String>, std::io::Error> {
    let mut files = Vec::new();
    collect_md_recursive(std::path::Path::new(dir), &mut files)?;
    Ok(files)
}

fn collect_md_recursive(
    dir: &std::path::Path,
    files: &mut Vec<String>,
) -> Result<(), std::io::Error> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            // Skip hidden directories
            if let Some(name) = path.file_name() {
                if name.to_string_lossy().starts_with('.') {
                    continue;
                }
            }
            collect_md_recursive(&path, files)?;
        } else if let Some(ext) = path.extension() {
            if ext == "md" || ext == "markdown" {
                files.push(path.to_string_lossy().into_owned());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_index_status_serialization() {
        let status = IndexStatus {
            total_files: 100,
            indexed_files: 45,
            total_chunks: 500,
            is_indexing: true,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"is_indexing\":true"));
    }

    #[test]
    fn test_search_result_payload_serialization() {
        let payload = SearchResultPayload {
            chunk_id: "test-id".into(),
            file_path: "test.md".into(),
            heading_path: vec!["Title".into()],
            content: "Some content".into(),
            score: 0.95,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"chunk_id\":\"test-id\""));
        assert!(json.contains("\"score\":0.95"));
    }

    #[test]
    fn test_embedding_state_new() {
        let state = EmbeddingState::new();
        // Verify all fields are initialized
        assert!(Arc::strong_count(&state.vector_store) == 1);
        assert!(Arc::strong_count(&state.chunk_index) == 1);
        assert!(Arc::strong_count(&state.is_indexing) == 1);
    }
}
