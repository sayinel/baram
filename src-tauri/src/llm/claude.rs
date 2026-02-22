// §6.3 Claude SSE streaming provider

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::{LlmError, ModelInfo};

#[derive(Debug, Deserialize)]
pub(crate) struct ClaudeModelsResponse {
    pub data: Vec<ClaudeModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ClaudeModelEntry {
    pub id: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

/// List available Claude models via the Anthropic API.
pub async fn list_models(api_key: &str) -> Result<Vec<ModelInfo>, LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| LlmError::RequestFailed(e.to_string()))?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static("2023-06-01"),
    );

    let client = reqwest::Client::new();
    let response = client
        .get("https://api.anthropic.com/v1/models")
        .headers(headers)
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

    let body: ClaudeModelsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    let models = body
        .data
        .into_iter()
        .map(|m| ModelInfo {
            name: m.display_name.unwrap_or_else(|| m.id.clone()),
            id: m.id,
        })
        .collect();

    Ok(models)
}

#[derive(Debug, Serialize)]
struct ClaudeRequest {
    model: String,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<ClaudeMessage>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ClaudeMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SseEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub delta: Option<SseDelta>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SseDelta {
    #[serde(rename = "type")]
    #[serde(default)]
    pub delta_type: String,
    #[serde(default)]
    pub text: String,
}

/// Claude API SSE streaming call.
/// Emits llm:token, llm:done events to the frontend.
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        "x-api-key",
        HeaderValue::from_str(api_key).map_err(|e| LlmError::RequestFailed(e.to_string()))?,
    );
    headers.insert(
        "anthropic-version",
        HeaderValue::from_static("2023-06-01"),
    );

    let body = ClaudeRequest {
        model: model.to_string(),
        max_tokens,
        system: system_prompt.map(|s| s.to_string()),
        messages: vec![ClaudeMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
        stream: true,
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .headers(headers)
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

        // Parse SSE lines from buffer
        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim_end_matches('\r').to_string();
            buffer = buffer[line_end + 1..].to_string();

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app_handle.emit(
                        "llm:done",
                        serde_json::json!({ "requestId": request_id }),
                    );
                    return Ok(());
                }

                if let Ok(event) = serde_json::from_str::<SseEvent>(data) {
                    if event.event_type == "content_block_delta" {
                        if let Some(delta) = &event.delta {
                            if delta.delta_type == "text_delta" && !delta.text.is_empty() {
                                let _ = app_handle.emit(
                                    "llm:token",
                                    serde_json::json!({
                                        "requestId": request_id,
                                        "token": delta.text,
                                    }),
                                );
                            }
                        }
                    } else if event.event_type == "message_stop" {
                        let _ = app_handle.emit(
                            "llm:done",
                            serde_json::json!({ "requestId": request_id }),
                        );
                        return Ok(());
                    }
                }
            }
        }
    }

    // Stream ended without explicit message_stop
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
    fn test_sse_event_parse_content_block_delta() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let event: SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_delta");
        assert_eq!(event.delta.unwrap().text, "Hello");
    }

    #[test]
    fn test_sse_event_parse_message_stop() {
        let json = r#"{"type":"message_stop"}"#;
        let event: SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "message_stop");
        assert!(event.delta.is_none());
    }

    #[test]
    fn test_claude_request_serialization() {
        let req = ClaudeRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            max_tokens: 1024,
            system: Some("You are helpful.".to_string()),
            messages: vec![ClaudeMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            stream: true,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["model"], "claude-sonnet-4-20250514");
        assert_eq!(json["max_tokens"], 1024);
        assert_eq!(json["system"], "You are helpful.");
        assert_eq!(json["stream"], true);
        assert_eq!(json["messages"][0]["role"], "user");
    }

    #[test]
    fn test_claude_request_no_system() {
        let req = ClaudeRequest {
            model: "claude-sonnet-4-20250514".to_string(),
            max_tokens: 512,
            system: None,
            messages: vec![ClaudeMessage {
                role: "user".to_string(),
                content: "Hi".to_string(),
            }],
            stream: true,
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json.get("system").is_none());
    }

    #[test]
    fn test_sse_event_parse_content_block_start() {
        let json = r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#;
        let event: SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_start");
        assert!(event.delta.is_none());
    }
}
