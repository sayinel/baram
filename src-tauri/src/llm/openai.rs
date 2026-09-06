// §6.3 OpenAI-compatible SSE streaming provider

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::framing::{LineDecoder, LineEvent, ParseFailure};
use super::{emit_done, emit_token, map_framing_error, map_parse_failure, LlmError, ModelInfo};

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAIModelsResponse {
    pub data: Vec<OpenAIModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenAIModelEntry {
    pub id: String,
}

/// Chat model prefixes to filter from the full model list.
const CHAT_MODEL_PREFIXES: &[&str] = &["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];

/// List available OpenAI models, filtered to chat-relevant models.
pub async fn list_models(api_key: &str, base_url: &str) -> Result<Vec<ModelInfo>, LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut headers = HeaderMap::new();
    let auth_value = format!("Bearer {}", api_key);
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&auth_value).map_err(|e| LlmError::RequestFailed(e.to_string()))?,
    );

    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
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

    let body: OpenAIModelsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    let mut models: Vec<ModelInfo> = body
        .data
        .into_iter()
        .filter(|m| {
            CHAT_MODEL_PREFIXES
                .iter()
                .any(|prefix| m.id.starts_with(prefix))
        })
        .map(|m| ModelInfo {
            name: m.id.clone(),
            id: m.id,
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    stream: bool,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    store: Option<bool>,
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
    /// A top-level error envelope — the record is well-formed JSON, so without
    /// this it deserialised as "no choices" and vanished.
    #[serde(default)]
    pub error: Option<OpenAIError>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct OpenAIError {
    #[serde(default)]
    pub message: String,
    #[serde(default, rename = "type")]
    pub error_type: String,
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

const PROVIDER: &str = "openai";

/// One complete SSE line → what it means (issue 264). Every choice's content
/// is emitted BEFORE a finish reason ends the stream — the old loop checked
/// the finish first and dropped text carried in the final chunk.
pub(crate) fn parse_line(line: &str) -> Result<Vec<LineEvent>, ParseFailure> {
    let Some(data) = super::framing::sse_data(line) else {
        return Ok(Vec::new());
    };
    if data == "[DONE]" {
        return Ok(vec![LineEvent::Done]);
    }
    let chunk: OpenAISseChunk =
        serde_json::from_str(data).map_err(|e| super::framing::malformed_json(data, &e))?;
    if let Some(err) = chunk.error {
        return Err(ParseFailure::Provider(format!(
            "{}: {}",
            err.error_type, err.message
        )));
    }
    let mut events = Vec::new();
    let mut finished = false;
    for choice in chunk.choices {
        if let Some(content) = choice.delta.and_then(|d| d.content) {
            if !content.is_empty() {
                events.push(LineEvent::Token(content));
            }
        }
        match choice.finish_reason.as_deref() {
            None | Some("") => {}
            Some("content_filter") => {
                return Err(ParseFailure::Provider(
                    "generation stopped: finish_reason content_filter".to_string(),
                ));
            }
            // stop, length, and anything a compatible server may add.
            Some(_) => finished = true,
        }
    }
    if finished {
        events.push(LineEvent::Done);
    }
    Ok(events)
}

/// OpenAI-compatible SSE streaming call.
/// Works with OpenAI API and any OpenAI-compatible endpoint (e.g. Azure, vLLM, LM Studio).
/// Emits llm:token, llm:done events to the frontend.
#[allow(clippy::too_many_arguments)]
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    base_url: &str,
    privacy_mode: bool,
    mut cancel_rx: oneshot::Receiver<()>,
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
        HeaderValue::from_str(&auth_value).map_err(|e| LlmError::RequestFailed(e.to_string()))?,
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
        store: if privacy_mode { Some(false) } else { None },
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
    let mut decoder = LineDecoder::default();
    let mut token_count: u32 = 0;

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                return Err(LlmError::Cancelled);
            }
            chunk = stream.next() => {
                let Some(chunk) = chunk else {
                    break;
                };
                let chunk = chunk.map_err(|e| LlmError::RequestFailed(e.to_string()))?;
                // issue 264: bytes in, complete lines out — a chunk boundary can
                // no longer cut a character in half (framing.rs).
                decoder
                    .push(&chunk)
                    .map_err(|e| map_framing_error(PROVIDER, request_id, e))?;
                while let Some(line) = decoder.next_line() {
                    let line = line.map_err(|e| map_framing_error(PROVIDER, request_id, e))?;
                    let events =
                        parse_line(line).map_err(|f| map_parse_failure(PROVIDER, request_id, f))?;
                    for event in events {
                        match event {
                            LineEvent::Token(token) => {
                                token_count += 1;
                                emit_token(app_handle, request_id, &token);
                            }
                            LineEvent::Done => {
                                emit_done(app_handle, request_id, token_count);
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }

    // issue 264: the connection ended before the provider's terminal record.
    // An unterminated last SSE line is not an event; whatever it held went
    // with the connection. Say so instead of reporting a finished completion.
    Err(LlmError::IncompleteStream {
        provider: PROVIDER,
        request_id: request_id.to_string(),
        tokens: token_count,
    })
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
        assert_eq!(chunk.choices[0].finish_reason.as_deref(), Some("stop"));
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
            store: None,
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
            store: None,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_openai_sse_chunk_finish_reason_length() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}"#;
        let chunk: OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices[0].finish_reason.as_deref(), Some("length"));
    }
}
