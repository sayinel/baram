// §6.3 LLM IPC command — multi-provider streaming dispatch

use tauri::Emitter;

#[tauri::command]
pub async fn llm_complete(
    api_key: String,
    prompt: String,
    model: String,
    system_prompt: Option<String>,
    max_tokens: Option<u32>,
    request_id: String,
    provider: Option<String>,
    base_url: Option<String>,
    privacy_mode: Option<bool>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let tokens = max_tokens.unwrap_or(4096);
    let prov = provider.as_deref().unwrap_or("claude");
    let privacy = privacy_mode.unwrap_or(false);

    crate::llm::complete(
        prov,
        &api_key,
        &prompt,
        &model,
        system_prompt.as_deref(),
        tokens,
        &request_id,
        base_url.as_deref(),
        privacy,
        &app_handle,
    )
    .await
    .map_err(|e| {
        let _ = app_handle.emit(
            "llm:error",
            serde_json::json!({
                "requestId": request_id,
                "error": e.to_string(),
            }),
        );
        e.to_string()
    })
}
