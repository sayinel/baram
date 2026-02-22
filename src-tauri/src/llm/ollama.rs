// §6.3 Ollama NDJSON streaming provider (local/privacy mode)

use futures::StreamExt;
use reqwest::header::{HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::{LlmError, ModelInfo};

#[derive(Debug, Deserialize)]
pub(crate) struct OllamaTagsResponse {
    pub models: Vec<OllamaModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OllamaModelEntry {
    pub name: String,
}

/// List available Ollama models (no auth required).
pub async fn list_models(base_url: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(LlmError::RequestFailed(format!(
            "HTTP {}: {}",
            status, body_text
        )));
    }

    let body: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    let models = body
        .models
        .into_iter()
        .map(|m| ModelInfo {
            name: m.name.clone(),
            id: m.name,
        })
        .collect();

    Ok(models)
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    options: Option<OllamaOptions>,
}

#[derive(Debug, Serialize)]
struct OllamaOptions {
    num_predict: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OllamaResponse {
    #[serde(default)]
    pub response: String,
    #[serde(default)]
    pub done: bool,
}

/// Ollama NDJSON streaming call (local inference, no auth required).
/// Emits llm:token, llm:done events to the frontend.
pub async fn complete_stream(
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    base_url: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    let body = OllamaRequest {
        model: model.to_string(),
        prompt: prompt.to_string(),
        system: system_prompt.map(|s| s.to_string()),
        stream: true,
        options: Some(OllamaOptions {
            num_predict: max_tokens,
        }),
    };

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown error".to_string());
        return Err(LlmError::RequestFailed(format!(
            "HTTP {}: {}",
            status, body_text
        )));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| LlmError::RequestFailed(e.to_string()))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Parse NDJSON lines from buffer
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            if let Ok(resp) = serde_json::from_str::<OllamaResponse>(&line) {
                if resp.done {
                    let _ = app_handle.emit(
                        "llm:done",
                        serde_json::json!({ "requestId": request_id }),
                    );
                    return Ok(());
                }

                if !resp.response.is_empty() {
                    let _ = app_handle.emit(
                        "llm:token",
                        serde_json::json!({
                            "requestId": request_id,
                            "token": resp.response,
                        }),
                    );
                }
            }
        }
    }

    // Stream ended without explicit done:true
    let _ = app_handle.emit(
        "llm:done",
        serde_json::json!({ "requestId": request_id }),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ollama_response_parse_token() {
        let json = r#"{"model":"llama3","created_at":"2024-01-01T00:00:00Z","response":"Hello","done":false}"#;
        let resp: OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.response, "Hello");
        assert!(!resp.done);
    }

    #[test]
    fn test_ollama_response_parse_done() {
        let json = r#"{"model":"llama3","created_at":"2024-01-01T00:00:00Z","response":"","done":true,"total_duration":1234567890}"#;
        let resp: OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.response, "");
        assert!(resp.done);
    }

    #[test]
    fn test_ollama_response_parse_minimal() {
        let json = r#"{"response":"Hi","done":false}"#;
        let resp: OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.response, "Hi");
        assert!(!resp.done);
    }

    #[test]
    fn test_ollama_request_serialization_with_system() {
        let req = OllamaRequest {
            model: "llama3".to_string(),
            prompt: "Hello".to_string(),
            system: Some("You are helpful.".to_string()),
            stream: true,
            options: Some(OllamaOptions { num_predict: 2048 }),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["model"], "llama3");
        assert_eq!(json["prompt"], "Hello");
        assert_eq!(json["system"], "You are helpful.");
        assert_eq!(json["stream"], true);
        assert_eq!(json["options"]["num_predict"], 2048);
    }

    #[test]
    fn test_ollama_request_serialization_no_system() {
        let req = OllamaRequest {
            model: "mistral".to_string(),
            prompt: "Hello".to_string(),
            system: None,
            stream: true,
            options: None,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json.get("system").is_none());
        assert!(json.get("options").is_none());
    }

    #[test]
    fn test_ollama_response_empty_response_not_done() {
        let json = r#"{"response":"","done":false}"#;
        let resp: OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.response, "");
        assert!(!resp.done);
    }

    #[test]
    fn test_ollama_ndjson_multi_line_parse() {
        // Simulate multiple NDJSON lines
        let lines = r#"{"response":"Hello","done":false}
{"response":" world","done":false}
{"response":"","done":true}
"#;
        let responses: Vec<OllamaResponse> = lines
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();

        assert_eq!(responses.len(), 3);
        assert_eq!(responses[0].response, "Hello");
        assert!(!responses[0].done);
        assert_eq!(responses[1].response, " world");
        assert!(!responses[1].done);
        assert_eq!(responses[2].response, "");
        assert!(responses[2].done);
    }
}
