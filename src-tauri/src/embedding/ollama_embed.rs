// §11.4.2 Ollama embedding provider
// POST /api/embeddings → { model, prompt } → { embedding: [] }

use reqwest::Client;
use serde_json::json;

use super::EmbedConfig;
use super::EmbedError;

/// Build Ollama embedding request body JSON string.
pub fn build_ollama_embed_request(text: &str, model: &str) -> String {
    json!({
        "model": model,
        "prompt": text
    })
    .to_string()
}

/// Parse Ollama embedding response JSON.
pub fn parse_ollama_response(response: &str) -> Result<Vec<f32>, EmbedError> {
    let json: serde_json::Value =
        serde_json::from_str(response).map_err(|e| EmbedError::ParseError(e.to_string()))?;
    let embedding = json["embedding"]
        .as_array()
        .ok_or_else(|| EmbedError::ParseError("missing 'embedding' field".into()))?;
    embedding
        .iter()
        .map(|v| {
            v.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| EmbedError::ParseError("invalid number in embedding".into()))
        })
        .collect()
}

/// Embed a single text using Ollama.
pub async fn embed_text(
    client: &Client,
    text: &str,
    config: &EmbedConfig,
) -> Result<Vec<f32>, EmbedError> {
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("http://localhost:11434");
    let url = format!("{}/api/embeddings", base_url);
    let body = build_ollama_embed_request(text, &config.model);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| EmbedError::RequestFailed(e.to_string()))?;

    let text_resp = resp
        .text()
        .await
        .map_err(|e| EmbedError::RequestFailed(e.to_string()))?;

    parse_ollama_response(&text_resp)
}

/// Embed a batch of texts using Ollama (sequential, Ollama doesn't support batch).
pub async fn embed_batch(
    client: &Client,
    texts: Vec<String>,
    config: &EmbedConfig,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    let mut results = Vec::with_capacity(texts.len());
    for text in &texts {
        results.push(embed_text(client, text, config).await?);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_request_body_format() {
        let body = build_ollama_embed_request("test text", "nomic-embed-text");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["model"], "nomic-embed-text");
        assert_eq!(json["prompt"], "test text");
    }

    #[test]
    fn test_parse_ollama_embed_response() {
        let response = r#"{"embedding": [0.1, 0.2, 0.3]}"#;
        let embedding = parse_ollama_response(response).unwrap();
        assert_eq!(embedding, vec![0.1f32, 0.2f32, 0.3f32]);
    }

    #[test]
    fn test_parse_ollama_empty_response() {
        let response = r#"{}"#;
        let result = parse_ollama_response(response);
        assert!(result.is_err());
    }
}
