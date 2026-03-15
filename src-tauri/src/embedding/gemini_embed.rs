// §11.4.2 Gemini embedding provider
// POST embedContent → { content: { parts: [{ text }] } } → { embedding: { values: [] } }

use reqwest::Client;
use serde_json::json;

use super::EmbedConfig;
use super::EmbedError;

/// Build Gemini embedding request body JSON string.
pub fn build_gemini_embed_request(text: &str, model: &str) -> String {
    json!({
        "model": format!("models/{}", model),
        "content": {
            "parts": [{ "text": text }]
        }
    })
    .to_string()
}

/// Parse Gemini embedding response JSON.
pub fn parse_gemini_response(response: &str) -> Result<Vec<f32>, EmbedError> {
    let json: serde_json::Value =
        serde_json::from_str(response).map_err(|e| EmbedError::ParseError(e.to_string()))?;
    let values = json["embedding"]["values"]
        .as_array()
        .ok_or_else(|| EmbedError::ParseError("missing 'embedding.values' field".into()))?;
    values
        .iter()
        .map(|v| {
            v.as_f64()
                .map(|f| f as f32)
                .ok_or_else(|| EmbedError::ParseError("invalid number in embedding".into()))
        })
        .collect()
}

/// Embed a single text using Gemini.
pub async fn embed_text(
    client: &Client,
    text: &str,
    config: &EmbedConfig,
) -> Result<Vec<f32>, EmbedError> {
    let api_key = config.api_key.as_deref().ok_or(EmbedError::NoApiKey)?;
    let model = &config.model;
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:embedContent?key={}",
        model, api_key
    );
    let body = build_gemini_embed_request(text, model);

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

    parse_gemini_response(&text_resp)
}

/// Embed a batch of texts using Gemini (sequential, no native batch).
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
    fn test_gemini_request_body_format() {
        let body = build_gemini_embed_request("test text", "embedding-001");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["model"], "models/embedding-001");
        assert_eq!(json["content"]["parts"][0]["text"], "test text");
    }

    #[test]
    fn test_parse_gemini_embed_response() {
        let response = r#"{"embedding": {"values": [0.1, 0.2, 0.3]}}"#;
        let embedding = parse_gemini_response(response).unwrap();
        assert_eq!(embedding, vec![0.1f32, 0.2f32, 0.3f32]);
    }

    #[test]
    fn test_parse_gemini_empty_response() {
        let response = r#"{}"#;
        let result = parse_gemini_response(response);
        assert!(result.is_err());
    }
}
