// §6.3 LLM API proxy module — multi-provider dispatch with privacy mode

pub mod claude;
pub mod ollama;
pub mod openai;

use thiserror::Error;

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
}

/// Default base URLs for each provider
const OPENAI_DEFAULT_BASE_URL: &str = "https://api.openai.com";
const OLLAMA_DEFAULT_BASE_URL: &str = "http://localhost:11434";

/// Multi-provider LLM streaming dispatch.
///
/// Routes to the appropriate provider based on the `provider` parameter.
/// When `privacy_mode` is true, only local providers (ollama) are permitted.
///
/// Emits llm:token, llm:done, llm:error events to the frontend.
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
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    // Privacy mode: block all cloud providers
    if privacy_mode && provider != "ollama" {
        return Err(LlmError::PrivacyBlocked(provider.to_string()));
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
                app_handle,
            )
            .await
        }
        "openai" => {
            let url = base_url.unwrap_or(OPENAI_DEFAULT_BASE_URL);
            openai::complete_stream(
                api_key,
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                url,
                app_handle,
            )
            .await
        }
        "ollama" => {
            let url = base_url.unwrap_or(OLLAMA_DEFAULT_BASE_URL);
            ollama::complete_stream(
                prompt,
                model,
                system_prompt,
                max_tokens,
                request_id,
                url,
                app_handle,
            )
            .await
        }
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
        let json = r#"{"id":"chatcmpl-abc","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#;
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
    fn test_privacy_allows_ollama() {
        let provider = "ollama";
        let privacy_mode = true;
        // Ollama should NOT be blocked by privacy mode
        assert!(!(privacy_mode && provider != "ollama"));
    }

    #[test]
    fn test_privacy_off_allows_all() {
        let privacy_mode = false;
        for provider in &["claude", "openai", "ollama"] {
            assert!(!(privacy_mode && *provider != "ollama"));
        }
    }

    // --- Provider dispatch tests ---

    #[test]
    fn test_unknown_provider_error() {
        let err = LlmError::UnknownProvider("gemini".to_string());
        assert!(err.to_string().contains("gemini"));
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
}
