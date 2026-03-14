// §6.3 Google Gemini SSE streaming provider

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::oneshot;

use super::{LlmError, ModelInfo};

/// Redact the API key from error messages to prevent accidental leakage.
fn redact_api_key(msg: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return msg.to_string();
    }
    let prefix: String = api_key.chars().take(4).collect();
    if prefix.len() < api_key.len() {
        msg.replace(api_key, &format!("{}...REDACTED", prefix))
    } else {
        msg.replace(api_key, "REDACTED")
    }
}

const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

// --- Model listing types ---

#[derive(Debug, Deserialize)]
pub(crate) struct GeminiModelsResponse {
    #[serde(default)]
    pub models: Vec<GeminiModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GeminiModelEntry {
    pub name: String,
    #[serde(default, rename = "displayName")]
    pub display_name: Option<String>,
    #[serde(default, rename = "supportedGenerationMethods")]
    pub supported_generation_methods: Vec<String>,
}

/// List available Gemini models, filtered to those supporting generateContent.
pub async fn list_models(api_key: &str) -> Result<Vec<ModelInfo>, LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let url = format!("{}/models", GEMINI_BASE_URL);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("x-goog-api-key", api_key)
        .send()
        .await
        .map_err(|e| LlmError::RequestFailed(redact_api_key(&e.to_string(), api_key)))?;

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

    let body: GeminiModelsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    let mut models: Vec<ModelInfo> = body
        .models
        .into_iter()
        .filter(|m| {
            m.name.starts_with("models/gemini-")
                && m.supported_generation_methods
                    .contains(&"generateContent".to_string())
        })
        .map(|m| {
            // name is "models/gemini-2.0-flash" → strip "models/" prefix for ID
            let id = m
                .name
                .strip_prefix("models/")
                .unwrap_or(&m.name)
                .to_string();
            ModelInfo {
                name: m.display_name.unwrap_or_else(|| id.clone()),
                id,
            }
        })
        .collect();

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}

// --- Streaming types ---

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "systemInstruction")]
    system_instruction: Option<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenerationConfig,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct GeminiPart {
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Serialize)]
struct GeminiGenerationConfig {
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GeminiSseChunk {
    #[serde(default)]
    pub candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GeminiCandidate {
    #[serde(default)]
    pub content: Option<GeminiCandidateContent>,
    #[serde(default, rename = "finishReason")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GeminiCandidateContent {
    #[serde(default)]
    pub parts: Vec<GeminiPart>,
}

/// Gemini API SSE streaming call.
/// Emits llm:token, llm:done events to the frontend.
#[allow(clippy::too_many_arguments)]
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    mut cancel_rx: oneshot::Receiver<()>,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let system_instruction = system_prompt.map(|s| GeminiContent {
        role: None,
        parts: vec![GeminiPart {
            text: s.to_string(),
        }],
    });

    let body = GeminiRequest {
        contents: vec![GeminiContent {
            role: Some("user".to_string()),
            parts: vec![GeminiPart {
                text: prompt.to_string(),
            }],
        }],
        system_instruction,
        generation_config: GeminiGenerationConfig {
            max_output_tokens: max_tokens,
        },
    };

    let url = format!(
        "{}/models/{}:streamGenerateContent?alt=sse",
        GEMINI_BASE_URL, model
    );

    // Pass API key as header instead of URL query parameter to prevent
    // accidental exposure in logs, network traces, and error messages.
    headers.insert(
        reqwest::header::HeaderName::from_static("x-goog-api-key"),
        reqwest::header::HeaderValue::from_str(api_key).map_err(|_| LlmError::NoApiKey)?,
    );

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| LlmError::RequestFailed(redact_api_key(&e.to_string(), api_key)))?;

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
                let chunk = chunk.map_err(|e| LlmError::RequestFailed(redact_api_key(&e.to_string(), api_key)))?;
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
                        if let Ok(chunk) = serde_json::from_str::<GeminiSseChunk>(data) {
                            for candidate in &chunk.candidates {
                                // Extract token from content.parts
                                if let Some(content) = &candidate.content {
                                    for part in &content.parts {
                                        if !part.text.is_empty() {
                                            token_count += 1;
                                            let _ = app_handle.emit(
                                                "llm:token",
                                                serde_json::json!({
                                                    "requestId": request_id,
                                                    "token": part.text,
                                                }),
                                            );
                                        }
                                    }
                                }
                                // Check finish reason
                                if let Some(reason) = &candidate.finish_reason {
                                    if reason == "STOP" || reason == "MAX_TOKENS" {
                                        let _ = app_handle.emit(
                                            "llm:done",
                                            serde_json::json!({ "requestId": request_id, "totalTokens": token_count }),
                                        );
                                        return Ok(());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Stream ended without explicit finish reason
    let _ = app_handle.emit(
        "llm:done",
        serde_json::json!({ "requestId": request_id, "totalTokens": token_count }),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gemini_sse_chunk_parse_token() {
        let json =
            r#"{"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":null}]}"#;
        let chunk: GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.candidates.len(), 1);
        let content = chunk.candidates[0].content.as_ref().unwrap();
        assert_eq!(content.parts[0].text, "Hello");
    }

    #[test]
    fn test_gemini_sse_chunk_parse_finish() {
        let json = r#"{"candidates":[{"content":{"parts":[{"text":""}]},"finishReason":"STOP"}]}"#;
        let chunk: GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(chunk.candidates[0].finish_reason.as_deref(), Some("STOP"));
    }

    #[test]
    fn test_gemini_sse_chunk_empty_candidates() {
        let json = r#"{"candidates":[]}"#;
        let chunk: GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert!(chunk.candidates.is_empty());
    }

    #[test]
    fn test_gemini_request_serialization() {
        let req = GeminiRequest {
            contents: vec![GeminiContent {
                role: Some("user".to_string()),
                parts: vec![GeminiPart {
                    text: "Hello".to_string(),
                }],
            }],
            system_instruction: Some(GeminiContent {
                role: None,
                parts: vec![GeminiPart {
                    text: "You are helpful.".to_string(),
                }],
            }),
            generation_config: GeminiGenerationConfig {
                max_output_tokens: 1024,
            },
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["contents"][0]["role"], "user");
        assert_eq!(json["contents"][0]["parts"][0]["text"], "Hello");
        assert_eq!(
            json["systemInstruction"]["parts"][0]["text"],
            "You are helpful."
        );
        assert!(json["systemInstruction"].get("role").is_none());
        assert_eq!(json["generationConfig"]["maxOutputTokens"], 1024);
    }

    #[test]
    fn test_gemini_request_no_system() {
        let req = GeminiRequest {
            contents: vec![GeminiContent {
                role: Some("user".to_string()),
                parts: vec![GeminiPart {
                    text: "Hi".to_string(),
                }],
            }],
            system_instruction: None,
            generation_config: GeminiGenerationConfig {
                max_output_tokens: 512,
            },
        };
        let json = serde_json::to_value(&req).unwrap();
        assert!(json.get("systemInstruction").is_none());
    }

    #[test]
    fn test_gemini_models_response_parse() {
        let json = r#"{"models":[{"name":"models/gemini-2.0-flash","displayName":"Gemini 2.0 Flash","supportedGenerationMethods":["generateContent","countTokens"]},{"name":"models/gemini-1.5-pro","displayName":"Gemini 1.5 Pro","supportedGenerationMethods":["generateContent"]}]}"#;
        let resp: GeminiModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.models.len(), 2);
        assert_eq!(resp.models[0].name, "models/gemini-2.0-flash");
        assert_eq!(
            resp.models[0].display_name.as_deref(),
            Some("Gemini 2.0 Flash")
        );
        assert!(resp.models[0]
            .supported_generation_methods
            .contains(&"generateContent".to_string()));
    }

    #[test]
    fn test_gemini_models_filter_non_gemini() {
        let models = [
            GeminiModelEntry {
                name: "models/gemini-2.0-flash".to_string(),
                display_name: Some("Gemini 2.0 Flash".to_string()),
                supported_generation_methods: vec!["generateContent".to_string()],
            },
            GeminiModelEntry {
                name: "models/text-embedding-004".to_string(),
                display_name: Some("Text Embedding".to_string()),
                supported_generation_methods: vec!["embedContent".to_string()],
            },
        ];
        let filtered: Vec<&GeminiModelEntry> = models
            .iter()
            .filter(|m| {
                m.name.starts_with("models/gemini-")
                    && m.supported_generation_methods
                        .contains(&"generateContent".to_string())
            })
            .collect();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].name, "models/gemini-2.0-flash");
    }

    #[test]
    fn test_gemini_sse_chunk_finish_max_tokens() {
        let json = r#"{"candidates":[{"content":{"parts":[{"text":"..."}]},"finishReason":"MAX_TOKENS"}]}"#;
        let chunk: GeminiSseChunk = serde_json::from_str(json).unwrap();
        assert_eq!(
            chunk.candidates[0].finish_reason.as_deref(),
            Some("MAX_TOKENS")
        );
    }
}
