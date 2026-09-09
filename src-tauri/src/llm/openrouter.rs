// §6.3 OpenRouter provider — one key, many upstream models.
//
// OpenRouter speaks the OpenAI chat-completions wire format, so the SSE framing
// and record parsing are shared with `openai.rs` (`stream_chat_completions`).
// Only three things are ours: the fixed base URL, a model list whose ids are
// vendor-qualified (`anthropic/claude-...`), and a request body WITHOUT
// OpenAI's `store` flag — see `OpenRouterRequest`.

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

use super::openai::stream_chat_completions;
use super::{LlmError, ModelInfo};

pub(crate) const PROVIDER: &str = "openrouter";

#[derive(Debug, Deserialize)]
pub(crate) struct OpenRouterModelsResponse {
    pub data: Vec<OpenRouterModelEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenRouterModelEntry {
    pub id: String,
    /// Human-readable label, e.g. "Anthropic: Claude Sonnet 4.5". OpenRouter
    /// supplies this; the OpenAI models endpoint does not.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub architecture: Option<OpenRouterArchitecture>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OpenRouterArchitecture {
    #[serde(default)]
    pub output_modalities: Option<Vec<String>>,
}

/// Keep the models that can answer with text.
///
/// Measured against the live catalogue (2026-09-09, 431 models): every single
/// entry lists `text` among its output modalities, so today this filter drops
/// nothing. It is here for the day OpenRouter lists an embedding- or
/// audio-only model, which would otherwise land in the chat model picker. The
/// tests below therefore include a synthetic image-only entry — no real one
/// exists yet, and a fixture that cannot be rejected cannot prove a filter.
///
/// Two traps this shape avoids:
/// - Membership, not position: `google/gemini-2.5-flash-image` reports
///   `["image", "text"]`, so "first modality is text" would drop it.
/// - Not `modality == "text->text"`: that string is `text+image->text` for 273
///   of the 431, i.e. it would hide every vision-capable chat model.
///
/// An entry with no architecture metadata is kept: an unexpected response shape
/// should not empty the picker, and a wrong entry in a 431-row list costs the
/// user nothing next to a dropdown that silently offers nothing.
pub(crate) fn select_chat_models(body: OpenRouterModelsResponse) -> Vec<ModelInfo> {
    let mut models: Vec<ModelInfo> = body
        .data
        .into_iter()
        .filter(|m| {
            match m
                .architecture
                .as_ref()
                .and_then(|a| a.output_modalities.as_ref())
            {
                Some(outputs) => outputs.iter().any(|o| o == "text"),
                None => true,
            }
        })
        .map(|m| ModelInfo {
            name: m.name.unwrap_or_else(|| m.id.clone()),
            id: m.id,
        })
        .collect();

    // Sorting by id groups the list by vendor prefix (anthropic/…, google/…),
    // which is the closest thing to a category this catalogue has.
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models
}

/// List the OpenRouter models usable for text generation.
pub async fn list_models(api_key: &str) -> Result<Vec<ModelInfo>, LlmError> {
    // The catalogue endpoint is public, but requiring the key here keeps the
    // provider consistent with the others (and makes "no key" one error, not
    // an empty-looking success later at completion time).
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let url = format!("{}/v1/models", BASE_URL);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .bearer_auth(api_key)
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

    let body: OpenRouterModelsResponse = response
        .json()
        .await
        .map_err(|e| LlmError::RequestFailed(e.to_string()))?;

    Ok(select_chat_models(body))
}

/// OpenRouter's chat-completions body.
///
/// Deliberately NOT `openai::OpenAIRequest`: that type carries `store`, which
/// OpenAI reads as "do not retain this request". OpenRouter has no such
/// parameter — it drops unknown fields — so reusing that body would have the
/// app send a privacy flag that does nothing, and imply an assurance we cannot
/// make. Retention here is an account-level setting on OpenRouter's side.
#[derive(Debug, Serialize)]
struct OpenRouterRequest {
    model: String,
    messages: Vec<OpenRouterMessage>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Debug, Serialize)]
struct OpenRouterMessage {
    role: String,
    content: String,
}

/// Base URL. Fixed, not user-configurable: nothing about OpenRouter needs a
/// custom host, and leaving it out keeps the SSRF surface exactly where it was.
pub(crate) const BASE_URL: &str = "https://openrouter.ai/api";

/// Stream a completion from OpenRouter.
#[allow(clippy::too_many_arguments)]
pub async fn complete_stream(
    api_key: &str,
    prompt: &str,
    model: &str,
    system_prompt: Option<&str>,
    max_tokens: u32,
    request_id: &str,
    cancel_rx: oneshot::Receiver<()>,
    app_handle: &tauri::AppHandle,
) -> Result<(), LlmError> {
    if api_key.is_empty() {
        return Err(LlmError::NoApiKey);
    }

    let mut messages = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(OpenRouterMessage {
            role: "system".to_string(),
            content: sys.to_string(),
        });
    }
    messages.push(OpenRouterMessage {
        role: "user".to_string(),
        content: prompt.to_string(),
    });

    let body = OpenRouterRequest {
        model: model.to_string(),
        messages,
        stream: true,
        max_tokens,
    };

    let url = format!("{}/v1/chat/completions", BASE_URL);

    stream_chat_completions(
        PROVIDER, &url, api_key, &body, request_id, cancel_rx, app_handle,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shapes taken from the live catalogue on 2026-09-09, except the last.
    fn catalogue() -> OpenRouterModelsResponse {
        serde_json::from_str(
            r#"{"data":[
                {"id":"anthropic/claude-sonnet-4.5","name":"Anthropic: Claude Sonnet 4.5",
                 "architecture":{"modality":"text+image->text","output_modalities":["text"]}},
                {"id":"google/gemini-2.5-flash-image","name":"Google: Gemini 2.5 Flash Image",
                 "architecture":{"modality":"text+image->text+image","output_modalities":["image","text"]}},
                {"id":"openai/gpt-audio","name":"OpenAI: GPT Audio",
                 "architecture":{"modality":"text+audio->text+audio","output_modalities":["text","audio"]}},
                {"id":"openrouter/auto","name":"Auto Router",
                 "architecture":{"modality":"text+image+file+audio+video->text+image","output_modalities":["text","image"]}},
                {"id":"acme/speech-only","name":"Acme: Speech Only",
                 "architecture":{"modality":"text->audio","output_modalities":["audio"]}}
            ]}"#,
        )
        .unwrap()
    }

    #[test]
    fn drops_only_the_models_that_cannot_answer_with_text() {
        let ids: Vec<String> = select_chat_models(catalogue())
            .into_iter()
            .map(|m| m.id)
            .collect();

        // The synthetic audio-only entry is the one that must go. Everything
        // else — vision, image-output, audio-output — still returns text.
        assert_eq!(
            ids,
            vec![
                "anthropic/claude-sonnet-4.5",
                "google/gemini-2.5-flash-image",
                "openai/gpt-audio",
                "openrouter/auto",
            ]
        );
    }

    #[test]
    fn keeps_a_text_output_listed_after_another_modality() {
        // google/gemini-2.5-flash-image really does report ["image","text"];
        // a positional check would drop it.
        let ids: Vec<String> = select_chat_models(catalogue())
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert!(ids.iter().any(|id| id == "google/gemini-2.5-flash-image"));
    }

    #[test]
    fn keeps_the_auto_router() {
        // openrouter/auto outputs ["text","image"], so an exact `== ["text"]`
        // filter would delete the one model id that never goes stale.
        let ids: Vec<String> = select_chat_models(catalogue())
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert!(ids.iter().any(|id| id == "openrouter/auto"));
    }

    #[test]
    fn displays_the_provider_supplied_name() {
        let models = select_chat_models(catalogue());
        let claude = models
            .iter()
            .find(|m| m.id == "anthropic/claude-sonnet-4.5")
            .unwrap();
        assert_eq!(claude.name, "Anthropic: Claude Sonnet 4.5");
    }

    #[test]
    fn falls_back_to_the_id_when_a_name_is_missing() {
        let body: OpenRouterModelsResponse =
            serde_json::from_str(r#"{"data":[{"id":"acme/nameless"}]}"#).unwrap();
        let models = select_chat_models(body);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].name, "acme/nameless");
    }

    #[test]
    fn keeps_an_entry_with_no_architecture_metadata() {
        // An unexpected response shape must not empty the model picker.
        let body: OpenRouterModelsResponse =
            serde_json::from_str(r#"{"data":[{"id":"acme/unknown","name":"Acme"}]}"#).unwrap();
        assert_eq!(select_chat_models(body).len(), 1);
    }

    #[test]
    fn sorts_by_id_so_the_list_groups_by_vendor() {
        let body: OpenRouterModelsResponse = serde_json::from_str(
            r#"{"data":[{"id":"z/model"},{"id":"anthropic/b"},{"id":"anthropic/a"}]}"#,
        )
        .unwrap();
        let ids: Vec<String> = select_chat_models(body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["anthropic/a", "anthropic/b", "z/model"]);
    }

    #[test]
    fn request_body_carries_no_store_flag() {
        // OpenAI's `store: false` means nothing here (§ privacy). Serialising
        // it would put a dead privacy flag on the wire.
        let body = OpenRouterRequest {
            model: "openrouter/auto".to_string(),
            messages: vec![OpenRouterMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
            stream: true,
            max_tokens: 100,
        };
        let value = serde_json::to_value(&body).unwrap();
        let object = value.as_object().unwrap();
        assert!(!object.contains_key("store"));
        // Pin the whole key set: a future field lands here deliberately, not
        // by copying the OpenAI body back in.
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, vec!["max_tokens", "messages", "model", "stream"]);
    }

    #[test]
    fn request_body_puts_the_system_prompt_first() {
        let body = OpenRouterRequest {
            model: "m".to_string(),
            messages: vec![
                OpenRouterMessage {
                    role: "system".to_string(),
                    content: "sys".to_string(),
                },
                OpenRouterMessage {
                    role: "user".to_string(),
                    content: "hi".to_string(),
                },
            ],
            stream: true,
            max_tokens: 10,
        };
        let value = serde_json::to_value(&body).unwrap();
        assert_eq!(value["messages"][0]["role"], "system");
        assert_eq!(value["messages"][1]["role"], "user");
    }

    #[tokio::test]
    async fn empty_key_is_reported_before_any_request() {
        assert!(matches!(list_models("").await, Err(LlmError::NoApiKey)));
    }

    // ── Live API checks ──────────────────────────────────────────────────
    //
    // Mocked fixtures cannot tell us the URL, the auth header shape or the
    // response schema are right — the class of failure that ships looking
    // green. These talk to OpenRouter for real, so they are `#[ignore]`d.
    //
    // Run them with:
    //   cargo test --manifest-path src-tauri/Cargo.toml \
    //     llm::openrouter::live -- --ignored --nocapture
    //
    // The key is read from the OS keyring, where Settings → AI already put it,
    // so it never has to appear in a command line or an environment variable.
    // Falls back to OPENROUTER_API_KEY when the keyring has no entry.

    fn live_key() -> Option<String> {
        if let Ok(key) = crate::commands::keyring_cmd::get_provider_api_key(PROVIDER) {
            if !key.trim().is_empty() {
                return Some(key);
            }
        }
        std::env::var("OPENROUTER_API_KEY")
            .ok()
            .filter(|k| !k.trim().is_empty())
    }

    #[ignore = "talks to the real OpenRouter API"]
    #[tokio::test]
    async fn live_list_models_returns_a_usable_catalogue() {
        let Some(key) = live_key() else {
            panic!("no OpenRouter key: add one in Settings → AI, or set OPENROUTER_API_KEY");
        };

        let models = list_models(&key).await.expect("list_models failed");

        // The catalogue had 431 entries on 2026-09-09. Asserting a floor rather
        // than a count keeps this from failing every time OpenRouter adds a
        // model, while still catching an empty or single-entry response — the
        // shape a wrong filter or a schema change actually produces.
        assert!(
            models.len() > 100,
            "expected a large catalogue, got {}",
            models.len()
        );

        // Vendor-qualified ids are the whole reason this provider needs its own
        // list_models: the OpenAI prefix filter would have dropped all of them.
        assert!(
            models.iter().any(|m| m.id.contains('/')),
            "no vendor-qualified id in the catalogue"
        );

        // The default model this app selects must actually exist.
        assert!(
            models.iter().any(|m| m.id == "openrouter/auto"),
            "openrouter/auto is missing, but AI_PROVIDERS uses it as the default"
        );

        // And the display name must be the provider's label, not the id.
        let named = models
            .iter()
            .find(|m| m.id == "openrouter/auto")
            .expect("checked above");
        assert_ne!(named.name, named.id, "name fell back to the id");
        eprintln!(
            "catalogue: {} models, e.g. {} = {:?}",
            models.len(),
            named.id,
            named.name
        );
    }

    #[ignore = "talks to the real OpenRouter API"]
    #[tokio::test]
    async fn live_completion_streams_sse_tokens_for_our_request_body() {
        use super::super::framing::{LineDecoder, LineEvent};
        use futures::StreamExt;

        let Some(key) = live_key() else {
            panic!("no OpenRouter key: add one in Settings → AI, or set OPENROUTER_API_KEY");
        };

        // The exact body `complete_stream` sends, including the absence of
        // `store`. If OpenRouter rejected any of it, this is where we learn it.
        let body = OpenRouterRequest {
            model: "openrouter/auto".to_string(),
            messages: vec![OpenRouterMessage {
                role: "user".to_string(),
                content: "Reply with the single word: ok".to_string(),
            }],
            stream: true,
            max_tokens: 32,
        };

        let response = reqwest::Client::new()
            .post(format!("{}/v1/chat/completions", BASE_URL))
            .bearer_auth(&key)
            .json(&body)
            .send()
            .await
            .expect("request failed");
        assert!(
            response.status().is_success(),
            "HTTP {}: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        );

        // Decode with the same framing and parser the provider uses, so this
        // proves our pipeline reads OpenRouter's stream — not merely that the
        // endpoint answered.
        let mut stream = response.bytes_stream();
        let mut decoder = LineDecoder::default();
        let mut text = String::new();
        let mut saw_done = false;

        while let Some(chunk) = stream.next().await {
            decoder.push(&chunk.expect("chunk")).expect("framing");
            while let Some(line) = decoder.next_line() {
                let line = line.expect("utf-8 line");
                for event in super::super::openai::parse_line(line).expect("parse") {
                    match event {
                        LineEvent::Done => saw_done = true,
                        LineEvent::Token(token) => text.push_str(&token),
                    }
                }
            }
            if saw_done {
                break;
            }
        }

        eprintln!("streamed {:?} (terminal record: {saw_done})", text);
        assert!(saw_done, "stream ended without a terminal record");
        assert!(!text.is_empty(), "no text tokens arrived");
    }
}
