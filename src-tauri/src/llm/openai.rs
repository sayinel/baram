// §6.3 OpenAI-compatible SSE streaming provider

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

use super::LlmError;

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAISseChunk {
    #[serde(default)]
    pub choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAIChoice {
    #[serde(default)]
    pub delta: Option<OpenAIDelta>,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAIDelta {
    #[serde(default)]
    pub content: Option<String>,
}

/// OpenAI-compatible SSE streaming call.
/// Works with OpenAI API and any OpenAI-compatible endpoint (e.g. Azure, vLLM, LM Studio).
/// Emits llm:token, llm:done events to the frontend.
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    base_url: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let auth_value = format!("Bearer {}", api_key);
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value)
            .map_err(|e| LlmError::RequestFailed(e.to_string()))?,
    );

    let mut messages = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(OpenAIMessage {
            role: "system".to_string(),
            content: sys.to_string(),
        });
    }
    messages.push(OpenAIMessage {
        role: "user".to_string(),
        content: prompt.to_string(),
    });

    let body = OpenAIRequest {
        model: model.to_string(),
        messages,
        stream: true,
        max_tokens,
    };

    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
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

            if line.is_empty() {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    let _ = app_handle.emit(
                        "llm:done",
                        serde_json::json!({ "requestId": request_id }),
                    );
                    return Ok(());
                }

                if let Ok(chunk) = serde_json::from_str::<OpenAISseChunk>(data) {
                    for choice in &chunk.choices {
                        // Check finish_reason first
                        if let Some(reason) = &choice.finish_reason {
                            if reason == "stop" || reason == "length" {
                                let _ = app_handle.emit(
                                    "llm:done",
                                    serde_json::json!({ "requestId": request_id }),
                                );
                                return Ok(());
                            }
                        }
                        // Extract token from delta
                        if let Some(delta) = &choice.delta {
                            if let Some(content) = &delta.content {
                                if !content.is_empty() {
                                    let _ = app_handle.emit(
                                        "llm:token",
                                        serde_json::json!({
                                            "requestId": request_id,
                                            "token": content,
                                        }),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Stream ended without explicit [DONE]
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
    fn test_openai_sse_chunk_parse_token() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices.len(), 1);
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().content.as_deref(),
            Some("Hello")
        );
        assert!(chunk.choices[0].finish_reason.is_none());
    }

    #[test]
    fn test_openai_sse_chunk_parse_finish() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices.len(), 1);
        assert_eq!(
            chunk.choices[0].finish_reason.as_deref(),
            Some("stop")
        );
    }

    #[test]
    fn test_openai_sse_chunk_parse_role_only() {
        // First chunk often has role but no content
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices.len(), 1);
        let delta = chunk.choices[0].delta.as_ref().unwrap();
        assert!(delta.content.is_none());
    }

    #[test]
    fn test_openai_sse_chunk_empty_choices() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert!(chunk.choices.is_empty());
    }

    #[test]
    fn test_openai_request_with_system() {
        let body = OpenAIRequest {
            model: "gpt-4o".to_string(),
            messages: vec![
                OpenAIMessage {
                    role: "system".to_string(),
                    content: "You are helpful.".to_string(),
                },
                OpenAIMessage {
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                },
            ],
            stream: true,
            max_tokens: 1024,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["messages"].as_array().unwrap().len(), 2);
        assert_eq!(json["messages"][0]["role"], "system");
        assert_eq!(json["messages"][1]["role"], "user");
        assert_eq!(json["stream"], true);
    }

    #[test]
    fn test_openai_request_without_system() {
        let body = OpenAIRequest {
            model: "gpt-4o-mini".to_string(),
            messages: vec![OpenAIMessage {
                role: "user".to_string(),
                content: "Hello".to_string(),
            }],
            stream: true,
            max_tokens: 512,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_openai_sse_chunk_finish_reason_length() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(
            chunk.choices[0].finish_reason.as_deref(),
            Some("length")
        );
    }
}
