// §11.4.2 OpenAI embedding provider
// POST /v1/embeddings → { model, input } → { data: [{ embedding }] }

use reqwest::Client;
use serde_json::json;

use super::EmbedConfig;
use super::EmbedError;

/// Build OpenAI embedding request body JSON string.
pub fn build_openai_embed_request(texts: &[String], model: &str) -> String {
    json!({
        "model": model,
        "input": texts
    })
    .to_string()
}

/// Parse OpenAI embedding response JSON.
pub fn parse_openai_response(response: &str) -> Result<Vec<Vec<f32>>, EmbedError> {
    let json: serde_json::Value =
        serde_json::from_str(response).map_err(|e| EmbedError::ParseError(e.to_string()))?;
    let data = json["data"]
        .as_array()
        .ok_or_else(|| EmbedError::ParseError("missing 'data' field".into()))?;

    data.iter()
        .map(|item| {
            let embedding = item["embedding"]
                .as_array()
                .ok_or_else(|| EmbedError::ParseError("missing 'embedding' in data item".into()))?;
            embedding
                .iter()
                .map(|v| {
                    v.as_f64()
                        .map(|f| f as f32)
                        .ok_or_else(|| EmbedError::ParseError("invalid number in embedding".into()))
                })
                .collect()
        })
        .collect()
}

/// Embed a batch of texts using OpenAI (supports native batch).
pub async fn embed_batch(
    client: &Client,
    texts: Vec<String>,
    config: &EmbedConfig,
) -> Result<Vec<Vec<f32>>, EmbedError> {
    let api_key = config.api_key.as_deref().ok_or(EmbedError::NoApiKey)?;
    let base_url = config
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com");
    let url = format!("{}/v1/embeddings", base_url);
    let body = build_openai_embed_request(&texts, &config.model);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .body(body)
        .send()
        .await
        .map_err(|e| EmbedError::RequestFailed(e.to_string()))?;

    let text_resp = resp
        .text()
        .await
        .map_err(|e| EmbedError::RequestFailed(e.to_string()))?;

    parse_openai_response(&text_resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_openai_request_body_format() {
        let texts = vec!["hello".to_string(), "world".to_string()];
        let body = build_openai_embed_request(&texts, "text-embedding-3-small");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["model"], "text-embedding-3-small");
        assert_eq!(json["input"][0], "hello");
        assert_eq!(json["input"][1], "world");
    }

    #[test]
    fn test_parse_openai_embed_response() {
        let response = r#"{"data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}]}"#;
        let embeddings = parse_openai_response(response).unwrap();
        assert_eq!(embeddings.len(), 2);
        assert_eq!(embeddings[0], vec![0.1f32, 0.2f32]);
        assert_eq!(embeddings[1], vec![0.3f32, 0.4f32]);
    }

    #[test]
    fn test_parse_openai_empty_response() {
        let response = r#"{}"#;
        let result = parse_openai_response(response);
        assert!(result.is_err());
    }
}
