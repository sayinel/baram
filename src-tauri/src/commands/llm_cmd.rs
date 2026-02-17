// §6.3 LLM IPC 커맨드 — Claude SSE 스트리밍

use tauri::Emitter;

#[tauri::command]
pub async fn llm_complete(
    api_key: String,
    prompt: String,
    model: String,
    system_prompt: Option<String>,
    max_tokens: Option<u32>,
    request_id: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let tokens = max_tokens.unwrap_or(4096);

    crate::llm::complete(
        &api_key,
        &prompt,
        &model,
        system_prompt.as_deref(),
        tokens,
        &request_id,
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
