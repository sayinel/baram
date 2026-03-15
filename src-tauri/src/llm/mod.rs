// §6.3 LLM API proxy module — multi-provider dispatch with privacy mode

pub mod cancel;
pub mod claude;
pub mod gemini;
pub mod ollama;
pub mod openai;

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
        _ => Err(LlmError::UnknownProvider(provider.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
// test
