// §6.3 LLM IPC command — multi-provider streaming dispatch + model listing + cancellation

use crate::llm::cancel::CancelRegistry;
use crate::llm::ModelInfo;
use tauri::Emitter;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn llm_complete(
    prompt: String,
    model: String,
    system_prompt: Option<String>,
    max_tokens: Option<u32>,
    request_id: String,
    provider: Option<String>,
    base_url: Option<String>,
    privacy_mode: Option<bool>,
    cancel_registry: tauri::State<'_, CancelRegistry>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let tokens = max_tokens.unwrap_or(4096);
    let prov = provider.as_deref().unwrap_or("claude");
    let privacy = privacy_mode.unwrap_or(false);

    // §backlog #1 — read the API key from the OS keyring in the backend instead
    // of accepting it over IPC (it no longer travels alongside prompt content).
    let api_key = crate::commands::keyring_cmd::get_provider_api_key(prov)?;

    let cancel_rx = cancel_registry.register(&request_id).await;

    let result = crate::llm::complete(
        prov,
        &api_key,
        &prompt,
        &model,
        system_prompt.as_deref(),
        tokens,
        &request_id,
        base_url.as_deref(),
        privacy,
        cancel_rx,
        &app_handle,
    )
    .await;

    // Clean up registry entry on completion
    cancel_registry.remove(&request_id).await;

    result.map_err(|e| {
        // Don't emit error event for cancellations — frontend already knows
        if !matches!(e, crate::llm::LlmError::Cancelled) {
            let _ = app_handle.emit(
                "llm:error",
                serde_json::json!({
                    "requestId": request_id,
                    "error": e.to_string(),
                }),
            );
        }
        e.to_string()
    })
}

#[tauri::command]
pub async fn llm_cancel(
    request_id: String,
    cancel_registry: tauri::State<'_, CancelRegistry>,
) -> Result<bool, String> {
    Ok(cancel_registry.cancel(&request_id).await)
}

#[tauri::command]
pub async fn llm_list_models(
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    // §259 — read the provider key from the OS keyring in the backend instead of
    // accepting it over IPC. Ollama is keyless (empty). Providers with no key
    // configured surface the keyring error directly to the caller.
    let api_key = crate::commands::keyring_cmd::get_provider_api_key(&provider)?;
    crate::llm::list_models(&provider, &api_key, base_url.as_deref())
        .await
        .map_err(|e| e.to_string())
}
