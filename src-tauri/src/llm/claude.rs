// §6.3 Claude SSE streaming provider

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::framing::{LineDecoder, LineEvent, ParseFailure};
use super::{emit_done, emit_token, map_framing_error, map_parse_failure, LlmError, ModelInfo};

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
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

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
    /// Present on `type: "error"` events (overloaded, rate limit, bad request).
    #[serde(default)]
    pub error: Option<SseErrorBody>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct SseErrorBody {
    #[serde(default, rename = "type")]
    pub error_type: String,
    #[serde(default)]
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct SseDelta {
    #[serde(rename = "type")]
    #[serde(default)]
    pub delta_type: String,
    #[serde(default)]
    pub text: String,
    /// On a `message_delta`: why the message stopped. `refusal` is the
    /// streaming classifier declining mid-stream — a 200 with text, not an
    /// `error` event (docs: handle-streaming-refusals).
    #[serde(default)]
    pub stop_reason: Option<String>,
}

const PROVIDER: &str = "claude";

/// One complete SSE line → what it means (issue 264). Protocol lines carry no
/// event; `[DONE]` and `message_stop` end the stream; a `text_delta` is a
/// token; an `error` event is the provider refusing, not text — and so is a
/// `message_delta` whose `stop_reason` is `refusal`: the text streamed before
/// it is a declined completion, not one to insert or cache. The other stop
/// reasons (end_turn, max_tokens, stop_sequence, model_context_window_exceeded)
/// end normally at the `message_stop` that follows, as OpenAI's `length` and
/// Gemini's `MAX_TOKENS` do.
pub(crate) fn parse_line(line: &str) -> Result<Vec<LineEvent>, ParseFailure> {
    let Some(data) = super::framing::sse_data(line) else {
        return Ok(Vec::new());
    };
    if data == "[DONE]" {
        return Ok(vec![LineEvent::Done]);
    }
    let event: SseEvent =
        serde_json::from_str(data).map_err(|e| super::framing::malformed_json(data, &e))?;
    match event.event_type.as_str() {
        "error" => {
            let body = event.error.unwrap_or_default();
            Err(ParseFailure::Provider(format!(
                "{}: {}",
                body.error_type, body.message
            )))
        }
        "content_block_delta" => Ok(event
            .delta
            .filter(|d| d.delta_type == "text_delta" && !d.text.is_empty())
            .map(|d| vec![LineEvent::Token(d.text)])
            .unwrap_or_default()),
        "message_stop" => Ok(vec![LineEvent::Done]),
        "message_delta" => match event.delta.and_then(|d| d.stop_reason) {
            Some(reason) if reason == "refusal" => Err(ParseFailure::Provider(
                "generation stopped: stop_reason refusal".to_string(),
            )),
            _ => Ok(Vec::new()),
        },
        // message_start, content_block_start/stop, ping
        _ => Ok(Vec::new()),
    }
}

/// Claude API SSE streaming call.
/// Emits llm:token, llm:done events to the frontend.
#[allow(clippy::too_many_arguments)]
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    privacy_mode: bool,
    mut cancel_rx: oneshot::Receiver<()>,
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
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
    if privacy_mode {
        headers.insert("anthropic-no-store", HeaderValue::from_static("true"));
    }

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
        let json =
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#;
        let event: SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_start");
        assert!(event.delta.is_none());
    }
}
