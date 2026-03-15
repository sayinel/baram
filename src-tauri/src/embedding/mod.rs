// §11.4 Knowledge Q&A — Embedding module
// Many items are not yet wired into IPC commands; suppress until editor integration.
#![allow(dead_code)]

pub mod chunker;
pub mod gemini_embed;
pub mod hybrid_ranker;
pub mod ollama_embed;
pub mod openai_embed;
pub mod vector_store;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum EmbedError {
    #[error("API key not provided")]
    NoApiKey,
    #[error("HTTP request failed: {0}")]
    RequestFailed(String),
    #[error("Failed to parse response: {0}")]
    ParseError(String),
    #[error("Unsupported embedding provider: {0}")]
    UnsupportedProvider(String),
}

/// Configuration for embedding providers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbedConfig {
    pub model: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

/// Multi-provider embedding dispatch.
pub async fn embed_texts(
    client: &reqwest::Client,
    texts: Vec<String>,
    provider: &str,
    config: &EmbedConfig,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    match provider {
        "ollama" => ollama_embed::embed_batch(client, texts, config).await,
        "openai" => openai_embed::embed_batch(client, texts, config).await,
        "gemini" => gemini_embed::embed_batch(client, texts, config).await,
        _ => Err(EmbedError::UnsupportedProvider(provider.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_unsupported_provider() {
        let client = reqwest::Client::new();
        let config = EmbedConfig {
            model: "test".into(),
            api_key: None,
            base_url: None,
        };
        let result = embed_texts(&client, vec!["test".into()], "unknown", &config).await;
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Unsupported embedding provider"));
    }
}
