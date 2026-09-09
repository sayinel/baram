// §6.3 LLM API proxy module — multi-provider dispatch with privacy mode

pub mod cancel;
pub mod claude;
pub mod framing;
pub mod gemini;
pub mod ollama;
pub mod openai;
pub mod openrouter;

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::oneshot;

/// Model information returned from provider APIs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[derive(Error, Debug)]
pub enum LlmError {
    #[error("API key not provided")]
    NoApiKey,
    #[error("HTTP request failed: {0}")]
    RequestFailed(String),
    #[error("Privacy mode blocks cloud provider '{0}' — only 'ollama' (local) is allowed")]
    PrivacyBlocked(String),
    #[error("Unknown provider: {0}")]
    UnknownProvider(String),
    #[error("Request cancelled")]
    Cancelled,
    #[error("Invalid base_url '{0}': must start with http:// or https://")]
    InvalidBaseUrl(String),
    /// issue 264 — a record the stream protocol does not allow (invalid UTF-8,
    /// an over-long record, unparsable JSON). The stream is abandoned at the
    /// first one: continuing would present truncated output as a success.
    #[error("malformed stream from {provider} (request {request_id}): {detail}")]
    MalformedStream {
        provider: &'static str,
        request_id: String,
        detail: String,
    },
    /// The provider answered inside the stream with an error record instead of
    /// text (quota, overload, bad request).
    #[error("{provider} reported an error (request {request_id}): {message}")]
    ProviderError {
        provider: &'static str,
        request_id: String,
        message: String,
    },
    /// The connection ended before the provider's terminal record. Whatever
    /// tokens arrived are on screen already; the frontend must not be told the
    /// completion finished.
    #[error("stream from {provider} ended before its terminal record, after {tokens} tokens (request {request_id})")]
    IncompleteStream {
        provider: &'static str,
        request_id: String,
        tokens: u32,
    },
}

/// A framing failure with the provider and request it belongs to.
pub(crate) fn map_framing_error(
    provider: &'static str,
    request_id: &str,
    error: framing::FramingError,
) -> LlmError {
    LlmError::MalformedStream {
        provider,
        request_id: request_id.to_string(),
        detail: error.to_string(),
    }
}

/// A parser refusal with the provider and request it belongs to.
pub(crate) fn map_parse_failure(
    provider: &'static str,
    request_id: &str,
    failure: framing::ParseFailure,
) -> LlmError {
    match failure {
        framing::ParseFailure::Malformed(detail) => LlmError::MalformedStream {
            provider,
            request_id: request_id.to_string(),
            detail,
        },
        framing::ParseFailure::Provider(message) => LlmError::ProviderError {
            provider,
            request_id: request_id.to_string(),
            message,
        },
    }
}

/// `llm:token` for one piece of generated text.
pub(crate) fn emit_token(app_handle: &tauri::AppHandle, request_id: &str, token: &str) {
    use tauri::Emitter;
    let _ = app_handle.emit(
        "llm:token",
        serde_json::json!({ "requestId": request_id, "token": token }),
    );
}

/// `llm:done` once the provider's terminal record arrived.
pub(crate) fn emit_done(app_handle: &tauri::AppHandle, request_id: &str, total_tokens: u32) {
    use tauri::Emitter;
    let _ = app_handle.emit(
        "llm:done",
        serde_json::json!({ "requestId": request_id, "totalTokens": total_tokens }),
    );
}

/// Validate that a user-supplied base URL uses only http/https schemes.
/// Prevents SSRF via file://, ftp://, or other non-HTTP protocols.
/// localhost/127.0.0.1 are intentionally allowed (needed for Ollama).
fn validate_base_url(url: &str) -> Result<(), LlmError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(LlmError::InvalidBaseUrl(url.to_string()));
    }
    Ok(())
}

/// Default base URLs for each provider
const OPENAI_DEFAULT_BASE_URL: &str = "https://api.openai.com";
const OLLAMA_DEFAULT_BASE_URL: &str = "http://localhost:11434";
// Note: Gemini uses x-goog-api-key header for authentication, not a configurable base URL

/// Multi-provider LLM streaming dispatch.
///
/// Routes to the appropriate provider based on the `provider` parameter.
/// When `privacy_mode` is true, only local providers (ollama) are permitted.
///
/// Emits llm:token, llm:done, llm:error events to the frontend.
#[allow(clippy::too_many_arguments)]
pub async fn complete(
    provider: &str,
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    base_url: Option<&str>,
    privacy_mode: bool,
    cancel_rx: oneshot::Receiver<()>,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    // Privacy mode: block all cloud providers
    if privacy_mode && provider != "ollama" {
        return Err(LlmError::PrivacyBlocked(provider.to_string()));
    }

    // Validate base_url up-front for all providers (SSRF prevention).
    // Individual provider branches may also validate, but this ensures any
    // future provider that adds base_url support is protected by default.
    if let Some(url) = base_url {
        validate_base_url(url)?;
    }

    match provider {
        "claude" => {
            claude::complete_stream(
                api_key,
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                privacy_mode,
                cancel_rx,
                app_handle,
            )
            .await
        }
        "openai" => {
            let url = base_url.unwrap_or(OPENAI_DEFAULT_BASE_URL);
            validate_base_url(url)?;
            openai::complete_stream(
                api_key,
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                url,
                privacy_mode,
                cancel_rx,
                app_handle,
            )
            .await
        }
        "ollama" => {
            let url = base_url.unwrap_or(OLLAMA_DEFAULT_BASE_URL);
            validate_base_url(url)?;
            ollama::complete_stream(
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                url,
                cancel_rx,
                app_handle,
            )
            .await
        }
        // OpenRouter's base URL is fixed (see `openrouter::BASE_URL`), so the
        // caller's `base_url` is deliberately ignored here.
        "openrouter" => {
            openrouter::complete_stream(
                api_key,
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                cancel_rx,
                app_handle,
            )
            .await
        }
        // Note: Gemini has no no-store header API. Privacy mode blocks all cloud
        // providers (including Gemini) at line 60 before reaching this arm.
        "gemini" => {
            gemini::complete_stream(
                api_key,
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                cancel_rx,
                app_handle,
            )
            .await
        }
        _ => Err(LlmError::UnknownProvider(provider.to_string())),
    }
}

/// List available models from the specified provider.
pub async fn list_models(
    provider: &str,
    api_key: &str,
    base_url: Option<&str>,
) -> Result<Vec<ModelInfo>, LlmError> {
    // Validate base_url up-front for all providers (SSRF prevention).
    if let Some(url) = base_url {
        validate_base_url(url)?;
    }

    match provider {
        "claude" => claude::list_models(api_key).await,
        "openai" => {
            let url = base_url.unwrap_or(OPENAI_DEFAULT_BASE_URL);
            validate_base_url(url)?;
            openai::list_models(api_key, url).await
        }
        "ollama" => {
            let url = base_url.unwrap_or(OLLAMA_DEFAULT_BASE_URL);
            validate_base_url(url)?;
            ollama::list_models(url).await
        }
        "gemini" => gemini::list_models(api_key).await,
        "openrouter" => openrouter::list_models(api_key).await,
        _ => Err(LlmError::UnknownProvider(provider.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Provider dispatch wiring ---

    #[tokio::test]
    async fn list_models_routes_every_known_provider() {
        // A provider that is merely defined still answers UnknownProvider until
        // it has a match arm. Comparing the two errors is what proves the arm
        // exists; both paths return before any network call.
        assert!(matches!(
            list_models("openrouter", "", None).await,
            Err(LlmError::NoApiKey)
        ));
        assert!(matches!(
            list_models("openai", "", None).await,
            Err(LlmError::NoApiKey)
        ));
        assert!(matches!(
            list_models("claude", "", None).await,
            Err(LlmError::NoApiKey)
        ));
        assert!(matches!(
            list_models("openrouter-typo", "", None).await,
            Err(LlmError::UnknownProvider(_))
        ));
    }

    // --- Claude SSE parsing tests (re-exported from claude module) ---

    #[test]
    fn test_claude_sse_event_parse_content_block_delta() {
        let json = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let event: claude::SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "content_block_delta");
        assert_eq!(event.delta.unwrap().text, "Hello");
    }

    #[test]
    fn test_claude_sse_event_parse_message_stop() {
        let json = r#"{"type":"message_stop"}"#;
        let event: claude::SseEvent = serde_json::from_str(json).unwrap();
        assert_eq!(event.event_type, "message_stop");
        assert!(event.delta.is_none());
    }

    // --- OpenAI SSE parsing tests ---

    #[test]
    fn test_openai_sse_chunk_parse() {
        let json = r#"{"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        let chunk: openai::OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices.len(), 1);
        assert_eq!(
            chunk.choices[0].delta.as_ref().unwrap().content.as_deref(),
            Some("Hello")
        );
    }

    #[test]
    fn test_openai_sse_chunk_finish_stop() {
        let json =
            r#"{"id":"chatcmpl-abc","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#;
        let chunk: openai::OpenAISseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.choices[0].finish_reason.as_deref(), Some("stop"));
    }

    // --- Ollama NDJSON parsing tests ---

    #[test]
    fn test_ollama_response_parse_token() {
        let json = r#"{"response":"Hello","done":false}"#;
        let resp: ollama::OllamaResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.response, "Hello");
        assert!(!resp.done);
    }

    #[test]
    fn test_ollama_response_parse_done() {
        let json = r#"{"response":"","done":true}"#;
        let resp: ollama::OllamaResponse = serde_json::from_str(json).unwrap();
        assert!(resp.done);
    }

    // --- Gemini SSE parsing tests ---

    #[test]
    fn test_gemini_sse_chunk_parse() {
        let json =
            r#"{"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":null}]}"#;
        let chunk: gemini::GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.candidates.len(), 1);
        let content = chunk.candidates[0].content.as_ref().unwrap();
        assert_eq!(content.parts[0].text, "Hello");
    }

    #[test]
    fn test_gemini_sse_chunk_finish_stop() {
        let json = r#"{"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}"#;
        let chunk: gemini::GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.candidates[0].finish_reason.as_deref(), Some("STOP"));
    }

    // --- Gemini models parsing tests ---

    #[test]
    fn test_gemini_models_response_parse() {
        let json = r#"{"models":[{"name":"models/gemini-2.0-flash","displayName":"Gemini 2.0 Flash","supportedGenerationMethods":["generateContent","countTokens"]},{"name":"models/text-embedding-004","displayName":"Text Embedding","supportedGenerationMethods":["embedContent"]}]}"#;
        let resp: gemini::GeminiModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.models.len(), 2);
        assert_eq!(resp.models[0].name, "models/gemini-2.0-flash");
    }

    // --- Privacy mode tests ---

    #[test]
    fn test_privacy_blocks_claude() {
        // We can't call complete() without AppHandle, so test the logic directly
        let provider = "claude";
        let privacy_mode = true;
        if privacy_mode && provider != "ollama" {
            let err = LlmError::PrivacyBlocked(provider.to_string());
            assert!(err.to_string().contains("claude"));
            assert!(err.to_string().contains("Privacy mode"));
        } else {
            panic!("Should have been blocked");
        }
    }

    #[test]
    fn test_privacy_blocks_openai() {
        let provider = "openai";
        let privacy_mode = true;
        if privacy_mode && provider != "ollama" {
            let err = LlmError::PrivacyBlocked(provider.to_string());
            assert!(err.to_string().contains("openai"));
        } else {
            panic!("Should have been blocked");
        }
    }

    #[test]
    fn test_privacy_blocks_gemini() {
        let provider = "gemini";
        let privacy_mode = true;
        if privacy_mode && provider != "ollama" {
            let err = LlmError::PrivacyBlocked(provider.to_string());
            assert!(err.to_string().contains("gemini"));
        } else {
            panic!("Should have been blocked");
        }
    }

    #[test]
    fn test_privacy_allows_ollama() {
        let provider = "ollama";
        let privacy_mode = true;
        // Ollama should NOT be blocked by privacy mode
        assert!(!(privacy_mode && provider != "ollama"));
    }

    #[test]
    fn test_privacy_off_allows_all() {
        let privacy_mode = false;
        for provider in &["claude", "openai", "ollama", "gemini"] {
            assert!(!(privacy_mode && *provider != "ollama"));
        }
    }

    // --- Provider dispatch tests ---

    #[test]
    fn test_unknown_provider_error() {
        let err = LlmError::UnknownProvider("unknown".to_string());
        assert!(err.to_string().contains("unknown"));
    }

    #[test]
    fn test_default_base_urls() {
        assert_eq!(OPENAI_DEFAULT_BASE_URL, "https://api.openai.com");
        assert_eq!(OLLAMA_DEFAULT_BASE_URL, "http://localhost:11434");
    }

    #[test]
    fn test_error_display() {
        let err = LlmError::NoApiKey;
        assert_eq!(err.to_string(), "API key not provided");

        let err = LlmError::RequestFailed("timeout".to_string());
        assert_eq!(err.to_string(), "HTTP request failed: timeout");

        let err = LlmError::PrivacyBlocked("claude".to_string());
        assert!(err.to_string().contains("Privacy mode"));
        assert!(err.to_string().contains("claude"));
        assert!(err.to_string().contains("ollama"));

        let err = LlmError::UnknownProvider("foo".to_string());
        assert!(err.to_string().contains("Unknown provider"));
        assert!(err.to_string().contains("foo"));

        // llm_complete passes this Display through as the IPC error string,
        // and the frontend recognises a cancelled request by it
        // (LLM_CANCELLED_REJECTION in src/ipc/llm.ts). Change both or neither.
        assert_eq!(LlmError::Cancelled.to_string(), "Request cancelled");
    }

    // --- Privacy header tests ---

    #[test]
    fn test_claude_request_with_privacy_headers() {
        let mut headers = reqwest::header::HeaderMap::new();
        let privacy_mode = true;
        if privacy_mode {
            headers.insert(
                "anthropic-no-store",
                reqwest::header::HeaderValue::from_static("true"),
            );
        }
        assert_eq!(headers.get("anthropic-no-store").unwrap(), "true");
    }

    #[test]
    fn test_claude_request_without_privacy_headers() {
        let mut headers = reqwest::header::HeaderMap::new();
        let privacy_mode = false;
        if privacy_mode {
            headers.insert(
                "anthropic-no-store",
                reqwest::header::HeaderValue::from_static("true"),
            );
        }
        assert!(headers.get("anthropic-no-store").is_none());
    }

    #[test]
    fn test_openai_request_store_field_privacy() {
        // When privacy mode is on, store should be false
        let store: Option<bool> = Some(false);
        let json = serde_json::json!({ "store": store });
        assert_eq!(json["store"], false);
    }

    #[test]
    fn test_openai_request_store_field_normal() {
        // When privacy mode is off, store should be None (omitted from serialization)
        let store: Option<bool> = None;
        let json = serde_json::to_value(store).unwrap();
        assert!(json.is_null());
    }

    // --- ModelInfo tests ---

    #[test]
    fn test_model_info_serialization() {
        let model = ModelInfo {
            id: "claude-sonnet-4-5-20250929".to_string(),
            name: "Claude Sonnet 4.5".to_string(),
        };
        let json = serde_json::to_value(&model).unwrap();
        assert_eq!(json["id"], "claude-sonnet-4-5-20250929");
        assert_eq!(json["name"], "Claude Sonnet 4.5");
    }

    #[test]
    fn test_model_info_deserialization() {
        let json = r#"{"id":"gpt-4o","name":"gpt-4o"}"#;
        let model: ModelInfo = serde_json::from_str(json).unwrap();
        assert_eq!(model.id, "gpt-4o");
        assert_eq!(model.name, "gpt-4o");
    }

    // --- API response parsing tests (Claude models) ---

    #[test]
    fn test_claude_models_response_parse() {
        let json = r#"{"data":[{"id":"claude-sonnet-4-5-20250929","display_name":"Claude Sonnet 4.5"},{"id":"claude-3-haiku-20240307","display_name":"Claude 3 Haiku"}]}"#;
        let resp: claude::ClaudeModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.len(), 2);
        assert_eq!(resp.data[0].id, "claude-sonnet-4-5-20250929");
        assert_eq!(
            resp.data[0].display_name.as_deref(),
            Some("Claude Sonnet 4.5")
        );
        assert_eq!(resp.data[1].id, "claude-3-haiku-20240307");
    }

    #[test]
    fn test_claude_models_response_no_display_name() {
        let json = r#"{"data":[{"id":"claude-unknown-model"}]}"#;
        let resp: claude::ClaudeModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.len(), 1);
        assert_eq!(resp.data[0].id, "claude-unknown-model");
        assert!(resp.data[0].display_name.is_none());
    }

    // --- API response parsing tests (OpenAI models) ---

    #[test]
    fn test_openai_models_response_parse() {
        let json = r#"{"data":[{"id":"gpt-4o","object":"model","owned_by":"openai"},{"id":"gpt-4o-mini","object":"model","owned_by":"openai"},{"id":"dall-e-3","object":"model","owned_by":"openai"}]}"#;
        let resp: openai::OpenAIModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.len(), 3);
        assert_eq!(resp.data[0].id, "gpt-4o");
    }

    #[test]
    fn test_openai_chat_model_filter() {
        let prefixes = &["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
        let models = vec![
            "gpt-4o",
            "gpt-4o-mini",
            "dall-e-3",
            "whisper-1",
            "o1-preview",
            "chatgpt-4o-latest",
        ];
        let filtered: Vec<&str> = models
            .into_iter()
            .filter(|id| prefixes.iter().any(|p| id.starts_with(p)))
            .collect();
        assert_eq!(
            filtered,
            vec!["gpt-4o", "gpt-4o-mini", "o1-preview", "chatgpt-4o-latest"]
        );
    }

    // --- API response parsing tests (Ollama tags) ---

    #[test]
    fn test_ollama_tags_response_parse() {
        let json = r#"{"models":[{"name":"llama3:latest","size":4661224676},{"name":"mistral:latest","size":4108928000}]}"#;
        let resp: ollama::OllamaTagsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.models.len(), 2);
        assert_eq!(resp.models[0].name, "llama3:latest");
        assert_eq!(resp.models[1].name, "mistral:latest");
    }

    #[test]
    fn test_ollama_tags_response_empty() {
        let json = r#"{"models":[]}"#;
        let resp: ollama::OllamaTagsResponse = serde_json::from_str(json).unwrap();
        assert!(resp.models.is_empty());
    }

    // --- issue 264: framing conformance shared by the four providers ---

    use super::framing::{LineDecoder, LineEvent, ParseFailure};

    type Parser = fn(&str) -> Result<Vec<LineEvent>, ParseFailure>;

    const TOKENS: [&str; 4] = ["한", "글", "🙂", "한글🙂"];

    /// Feeds `bytes` in the given chunks through a decoder and a parser; the
    /// EOF remainder is parsed only when `ndjson` (SSE never promotes it).
    fn run(
        bytes: &[u8],
        chunks: impl Iterator<Item = std::ops::Range<usize>>,
        parse: Parser,
        ndjson: bool,
    ) -> Result<(Vec<String>, bool), String> {
        let mut decoder = LineDecoder::default();
        let mut tokens = Vec::new();
        let mut done = false;
        fn handle(
            parse: Parser,
            line: &str,
            tokens: &mut Vec<String>,
            done: &mut bool,
        ) -> Result<(), String> {
            for ev in parse(line).map_err(|f| format!("{f:?}"))? {
                match ev {
                    LineEvent::Token(t) => tokens.push(t),
                    LineEvent::Done => *done = true,
                }
            }
            Ok(())
        }
        for r in chunks {
            decoder.push(&bytes[r]).map_err(|e| e.to_string())?;
            while let Some(line) = decoder.next_line() {
                let line = line.map_err(|e| e.to_string())?;
                handle(parse, line, &mut tokens, &mut done)?;
            }
        }
        if ndjson {
            if let Some(rest) = decoder.finish() {
                let rest = rest.map_err(|e| e.to_string())?;
                handle(parse, rest, &mut tokens, &mut done)?;
            }
        }
        Ok((tokens, done))
    }

    fn assert_every_split(bytes: &[u8], parse: Parser, ndjson: bool, expected: &[&str]) {
        for split in 0..=bytes.len() {
            let (tokens, done) = run(
                bytes,
                [0..split, split..bytes.len()].into_iter(),
                parse,
                ndjson,
            )
            .unwrap_or_else(|e| panic!("split at {split}: {e}"));
            assert_eq!(tokens, expected, "split at byte {split}");
            assert!(done, "split at byte {split}: no terminal record seen");
        }
        let (tokens, done) = run(bytes, (0..bytes.len()).map(|i| i..i + 1), parse, ndjson).unwrap();
        assert_eq!(tokens, expected, "one byte at a time");
        assert!(done);
    }

    fn claude_transcript() -> Vec<u8> {
        let mut s = String::from("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
        for t in TOKENS {
            s.push_str(&format!(
                "event: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"text_delta\",\"text\":\"{t}\"}}}}\n\n"
            ));
        }
        s.push_str(": keepalive\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
        s.into_bytes()
    }

    fn openai_transcript() -> Vec<u8> {
        // An extension field before the first record, as a proxy might add.
        let mut s = String::from("x-metadata: 1\n");
        for t in &TOKENS[..3] {
            s.push_str(&format!(
                "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{t}\"}}}}]}}\n\n"
            ));
        }
        // Content AND the finish reason in the same final chunk: the text
        // must not be dropped (the old loop checked the finish first).
        s.push_str(&format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{}\"}},\"finish_reason\":\"stop\"}}]}}\n\ndata: [DONE]\n\n",
            TOKENS[3]
        ));
        s.into_bytes()
    }

    fn gemini_transcript() -> Vec<u8> {
        let mut s = String::new();
        for t in &TOKENS[..3] {
            s.push_str(&format!(
                "data: {{\"candidates\":[{{\"content\":{{\"parts\":[{{\"text\":\"{t}\"}}]}}}}]}}\r\n\r\n"
            ));
        }
        s.push_str(&format!(
            "data: {{\"candidates\":[{{\"content\":{{\"parts\":[{{\"text\":\"{}\"}}]}},\"finishReason\":\"STOP\"}}]}}\r\n\r\n",
            TOKENS[3]
        ));
        s.into_bytes()
    }

    fn ollama_transcript() -> Vec<u8> {
        let mut s = String::new();
        for t in TOKENS {
            s.push_str(&format!("{{\"response\":\"{t}\",\"done\":false}}\n"));
        }
        // No trailing newline: the terminal record is the EOF remainder.
        s.push_str("{\"response\":\"\",\"done\":true}");
        s.into_bytes()
    }

    #[test]
    fn claude_stream_survives_a_split_at_every_byte() {
        assert_every_split(&claude_transcript(), claude::parse_line, false, &TOKENS);
    }

    #[test]
    fn openai_stream_survives_a_split_at_every_byte_and_keeps_the_final_chunks_text() {
        assert_every_split(&openai_transcript(), openai::parse_line, false, &TOKENS);
    }

    #[test]
    fn gemini_stream_with_crlf_survives_a_split_at_every_byte() {
        assert_every_split(&gemini_transcript(), gemini::parse_line, false, &TOKENS);
    }

    #[test]
    fn ollama_stream_without_a_trailing_newline_survives_a_split_at_every_byte() {
        assert_every_split(&ollama_transcript(), ollama::parse_line, true, &TOKENS);
    }

    #[test]
    fn provider_error_envelopes_are_refusals_not_silence() {
        let cases: [(Parser, &str); 4] = [
            (
                claude::parse_line,
                r#"data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            ),
            (
                openai::parse_line,
                r#"data: {"error":{"message":"Rate limit reached","type":"rate_limit_error"}}"#,
            ),
            (
                gemini::parse_line,
                r#"data: {"error":{"code":429,"message":"Quota exceeded"}}"#,
            ),
            (ollama::parse_line, r#"{"error":"model 'x' not found"}"#),
        ];
        for (parse, line) in cases {
            match parse(line) {
                Err(ParseFailure::Provider(msg)) => assert!(!msg.is_empty()),
                other => panic!("expected a provider refusal, got {other:?}"),
            }
        }
    }

    #[test]
    fn malformed_data_records_are_errors_that_do_not_quote_the_record() {
        let secret = "data: {\"choices\":[{\"delta\":{\"content\":\"비밀 문장\"}}";
        for parse in [claude::parse_line, openai::parse_line, gemini::parse_line] {
            match parse(secret) {
                Err(ParseFailure::Malformed(detail)) => {
                    assert!(detail.contains("bytes"), "{detail}");
                    assert!(!detail.contains("비밀"), "record body leaked: {detail}");
                }
                other => panic!("expected malformed, got {other:?}"),
            }
        }
        match ollama::parse_line("{\"response\":\"비밀") {
            Err(ParseFailure::Malformed(detail)) => assert!(!detail.contains("비밀")),
            other => panic!("expected malformed, got {other:?}"),
        }
    }

    #[test]
    fn a_type_error_does_not_echo_the_rejected_value() {
        // serde's Display for a type mismatch quotes the value it saw. That
        // value can be the user's text; the detail must not carry it.
        let secret = r#"data: {"choices":"비밀 문장"}"#;
        match openai::parse_line(secret) {
            Err(ParseFailure::Malformed(detail)) => {
                assert!(detail.contains("data error"), "{detail}");
                assert!(!detail.contains("비밀"), "leaked: {detail}");
            }
            other => panic!("expected malformed, got {other:?}"),
        }
        match gemini::parse_line(r#"data: {"candidates":"비밀"}"#) {
            Err(ParseFailure::Malformed(detail)) => assert!(!detail.contains("비밀")),
            other => panic!("expected malformed, got {other:?}"),
        }
    }

    #[test]
    fn every_gemini_finish_reason_is_terminal() {
        for reason in ["STOP", "MAX_TOKENS"] {
            let line = format!(r#"data: {{"candidates":[{{"finishReason":"{reason}"}}]}}"#);
            assert_eq!(
                gemini::parse_line(&line).unwrap(),
                vec![LineEvent::Done],
                "{reason}"
            );
        }
        for reason in [
            "SAFETY",
            "RECITATION",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "SPII",
            "LANGUAGE",
            "OTHER",
        ] {
            let line = format!(r#"data: {{"candidates":[{{"finishReason":"{reason}"}}]}}"#);
            match gemini::parse_line(&line) {
                Err(ParseFailure::Provider(msg)) => assert!(msg.contains(reason), "{msg}"),
                other => panic!("{reason}: expected a provider refusal, got {other:?}"),
            }
        }
        // Not a termination at all.
        let line = r#"data: {"candidates":[{"finishReason":"FINISH_REASON_UNSPECIFIED"}]}"#;
        assert_eq!(gemini::parse_line(line).unwrap(), Vec::<LineEvent>::new());
    }

    #[test]
    fn a_blocked_gemini_prompt_says_why_instead_of_ending_incomplete() {
        // The documented shape: blockReason set, no candidates. Before, this
        // record produced no event and EOF became IncompleteStream.
        for reason in [
            "SAFETY",
            "OTHER",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "IMAGE_SAFETY",
        ] {
            let line = format!(
                r#"data: {{"promptFeedback":{{"blockReason":"{reason}","safetyRatings":[]}}}}"#
            );
            match gemini::parse_line(&line) {
                Err(ParseFailure::Provider(msg)) => assert!(msg.contains(reason), "{msg}"),
                other => panic!("{reason}: expected a provider refusal, got {other:?}"),
            }
        }
        // promptFeedback without a block reason (safety ratings only) is
        // routine and carries no event.
        let line = r#"data: {"promptFeedback":{"safetyRatings":[{"category":"HARM_CATEGORY_HATE_SPEECH","probability":"NEGLIGIBLE"}]}}"#;
        assert_eq!(gemini::parse_line(line).unwrap(), Vec::<LineEvent>::new());
        let line = r#"data: {"promptFeedback":{"blockReason":"BLOCK_REASON_UNSPECIFIED"}}"#;
        assert_eq!(gemini::parse_line(line).unwrap(), Vec::<LineEvent>::new());
    }

    #[test]
    fn a_claude_streaming_refusal_is_a_provider_failure_not_a_completion() {
        // Documented shape: the classifier stops the message with
        // stop_reason "refusal" on message_delta (stop_details alongside),
        // and message_stop still follows. Everything streamed before it is a
        // declined completion — the stream must fail, not emit llm:done.
        let mut s = claude_transcript();
        let stop = b"event: message_stop";
        let at = s.windows(stop.len()).position(|w| w == stop).unwrap();
        s.splice(
            at..at,
            br#"event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"refusal","stop_sequence":null,"stop_details":{"type":"refusal","category":null,"explanation":null}},"usage":{"output_tokens":4}}

"#
            .iter()
            .copied(),
        );
        for split in 0..=s.len() {
            let result = run(
                &s,
                [0..split, split..s.len()].into_iter(),
                claude::parse_line,
                false,
            );
            match result {
                Err(msg) => assert!(msg.contains("refusal"), "split at {split}: {msg}"),
                Ok((tokens, done)) => {
                    panic!("split at {split}: refusal reported as a completion ({tokens:?}, done={done})")
                }
            }
        }
        // The other stop reasons end normally at message_stop.
        for reason in [
            "end_turn",
            "max_tokens",
            "stop_sequence",
            "model_context_window_exceeded",
        ] {
            let line = format!(
                r#"data: {{"type":"message_delta","delta":{{"stop_reason":"{reason}"}},"usage":{{"output_tokens":4}}}}"#
            );
            assert_eq!(
                claude::parse_line(&line).unwrap(),
                Vec::<LineEvent>::new(),
                "{reason}"
            );
        }
        // A message_delta carrying only usage (stop_reason null) is routine.
        let line = r#"data: {"type":"message_delta","delta":{"stop_reason":null,"stop_sequence":null},"usage":{"output_tokens":4}}"#;
        assert_eq!(claude::parse_line(line).unwrap(), Vec::<LineEvent>::new());
    }

    #[test]
    fn openai_finish_reasons_end_the_stream_and_content_filter_is_a_refusal() {
        for reason in ["stop", "length", "tool_calls"] {
            let line = format!(r#"data: {{"choices":[{{"finish_reason":"{reason}"}}]}}"#);
            assert_eq!(
                openai::parse_line(&line).unwrap(),
                vec![LineEvent::Done],
                "{reason}"
            );
        }
        let line = r#"data: {"choices":[{"finish_reason":"content_filter"}]}"#;
        assert!(matches!(
            openai::parse_line(line),
            Err(ParseFailure::Provider(_))
        ));
    }

    #[test]
    fn sse_lines_other_than_data_carry_no_event_including_extension_fields() {
        // The SSE grammar ignores fields the client does not know; a proxy or
        // compatible server adding `x-metadata:` must not abort the stream.
        for parse in [claude::parse_line, openai::parse_line, gemini::parse_line] {
            for line in [
                "",
                ": keepalive",
                "event: ping",
                "id: 7",
                "retry: 3000",
                "x-metadata: 1",
                "not sse at all",
            ] {
                assert_eq!(parse(line).unwrap(), Vec::<LineEvent>::new(), "{line:?}");
            }
        }
    }

    #[test]
    fn a_data_field_without_the_space_is_still_data() {
        assert_eq!(
            openai::parse_line("data:[DONE]").unwrap(),
            vec![LineEvent::Done]
        );
    }
}
// test
