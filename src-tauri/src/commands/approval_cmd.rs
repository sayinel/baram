// §333 게이트 — vault 경계를 넓히는 커맨드가 통과해야 하는 하나의 판정.
//
// ‼️ 다이얼로그는 사실상 `add_context`에서만 뜬다. `vault-context-loader.ts:50,97`의
// 제약 때문에 `addContext`가 `setVaultRoot`보다 먼저 돌고, `set_vault_root`가 도달할 땐
// 이미 승인 상태다. 그 순서를 바꾸면 프롬프트가 두 번 뜬다 (§329.4).

use crate::approval::{self, ApprovalKind, Decision};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// 프런트가 "사용자 거부"와 "진짜 오류"를 가르는 값. 문자열을 바꾸면
/// `src/ipc/approval.ts`의 `isApprovalDeniedError`도 같이 바꿔야 한다.
pub const APPROVAL_DENIED: &str = "VAULT_APPROVAL_DENIED";

/// UI 로케일. 프런트가 `uiLocale` 플랫 키에 미러한다(Task 5). 실패·미지원은 영어.
/// 웹뷰가 이 값을 바꿔도 **고정 표에서 언어를 고르는 것**뿐이라 문구를 주입할 수 없다.
///
/// Generic over the runtime — see `ensure_approved`'s doc comment for why.
fn is_korean<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    matches!(
        crate::config::get_config(app, "uiLocale"),
        Ok(Some(ref v)) if v == "ko"
    )
}

fn confirm_copy<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    canonical: &std::path::Path,
    kind: ApprovalKind,
) -> (String, String, String, String) {
    let shown = canonical.display();
    if is_korean(app) {
        let body = match kind {
            ApprovalKind::Dir => {
                format!("Baram이 이 폴더와 그 하위 전체를 읽고 쓰도록 허용할까요?\n\n{shown}")
            }
            // ‼️ §330 결정 3 — File 승인은 **부모 폴더의 이미지까지** 열린다(§329.2).
            // 좁히지 않기로 했으므로 여기서 그 사실을 말한다.
            ApprovalKind::File => {
                format!(
                    "Baram이 이 파일과, 같은 폴더에 있는 이미지를 읽도록 허용할까요?\n\n{shown}"
                )
            }
        };
        ("Vault 접근 허용".into(), body, "허용".into(), "거부".into())
    } else {
        let body = match kind {
            ApprovalKind::Dir => {
                format!(
                    "Allow Baram to read and write this folder and everything under it?\n\n{shown}"
                )
            }
            ApprovalKind::File => {
                format!("Allow Baram to read this file, and images in the same folder?\n\n{shown}")
            }
        };
        (
            "Allow vault access".into(),
            body,
            "Allow".into(),
            "Deny".into(),
        )
    }
}

/// 경로가 승인 범위에 들 때까지 확인한다. 미승인이면 네이티브 확인을 띄우고,
/// 승낙하면 기록한 뒤 Ok를 돌려준다.
///
/// ‼️ 제네릭 런타임: 호출자 `add_context`가 `search_cmd::search_files` /
/// `fs_cmd::ensure_path_in_vault`와 같은 이유로 `<R: tauri::Runtime>`이어야 IPC 레벨
/// mock 테스트(`tauri::test::mock_builder()`, `MockRuntime`)로 재현 가능해서 — 이 함수도
/// 같은 R을 그대로 받는다. 구체적인 `tauri::AppHandle`(= `AppHandle<Wry>`)을 넘기는 기존/
/// 미래 호출자는 그대로 컴파일된다(R이 Wry로 추론된다).
pub async fn ensure_approved<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    path: &str,
    kind: ApprovalKind,
) -> Result<(), String> {
    let store = approval::load(app);
    let (decision, canonical) = approval::decide(&store, path);
    match decision {
        Decision::Allowed => Ok(()),
        Decision::Denied => Err(APPROVAL_DENIED.to_string()),
        Decision::NeedsConfirmation => {
            let canonical = canonical.ok_or_else(|| APPROVAL_DENIED.to_string())?;
            let (title, body, ok, cancel) = confirm_copy(app, &canonical, kind);
            // ‼️ `blocking_show`가 아니라 콜백 + oneshot이다. blocking 형태는 플랫폼에
            // 따라 메인 스레드 요구와 충돌한다 — async 커맨드에서 안전한 쪽은 이쪽이다.
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .message(body)
                .title(title)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(ok, cancel))
                .show(move |granted| {
                    let _ = tx.send(granted);
                });
            if rx.await.unwrap_or(false) {
                approval::approve(app, &canonical, kind)?;
                Ok(())
            } else {
                Err(APPROVAL_DENIED.to_string())
            }
        }
    }
}

/// §332 신선한 선택은 Rust가 받는다 — 그 선택 자체가 승인이다.
///
/// ‼️ 확인 다이얼로그와 달리 파일/폴더 피커에는 본문 문구 자리가 없다. `set_title`이
/// 전부이므로, File 승인이 부모 폴더의 이미지까지 연다는 사실(§329.2, §330 결정 3)은
/// **타이틀**로 말한다.
///
/// ‼️ 제네릭 런타임: `tauri::test::mock_builder()`(런타임 = `MockRuntime`)가
/// `generate_handler!`로 이 커맨드를 실제 배선해야 아래 테스트가 "등록됨"을 고정할 수
/// 있다 — 구체적인 `tauri::AppHandle`(= `AppHandle<Wry>`)을 받으면 `MockRuntime`에서
/// `CommandArg`가 성립하지 않아 컴파일이 깨진다(`ensure_approved`와 같은 이유).
#[tauri::command]
pub async fn pick_approved_dir<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    purpose: String,
) -> Result<Option<String>, String> {
    let title = if is_korean(&app) {
        match purpose.as_str() {
            "journal" => "저널 폴더 선택",
            "zettelkasten" => "Zettelkasten 폴더 선택",
            "tasks" => "작업 폴더 선택",
            "plugin-dev" => "개발 중인 플러그인 폴더 선택",
            _ => "폴더 열기 — 이 폴더 전체를 읽고 씁니다",
        }
    } else {
        match purpose.as_str() {
            "journal" => "Choose a journal folder",
            "zettelkasten" => "Choose a Zettelkasten folder",
            "tasks" => "Choose a tasks folder",
            "plugin-dev" => "Choose a plugin development folder",
            _ => "Open folder — Baram will read and write everything under it",
        }
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_title(title).pick_folder(move |p| {
        let _ = tx.send(p);
    });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    approval::approve(&app, &canonical, ApprovalKind::Dir)?;
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_approved_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let title = if is_korean(&app) {
        "문서 열기 — 같은 폴더의 이미지도 함께 읽습니다"
    } else {
        "Open document — images in the same folder are read too"
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Markdown", &["md", "markdown", "mdx"])
        .add_filter("HTML", &["html", "htm"])
        .add_filter("PDF", &["pdf"])
        .add_filter(
            "Images",
            &["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"],
        )
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(picked) = rx.await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let canonical = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    approval::approve(&app, &canonical, ApprovalKind::File)?;
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn list_approved_roots(app: tauri::AppHandle) -> Result<Vec<approval::ApprovalEntry>, String> {
    Ok(approval::load(&app).entries)
}

#[tauri::command]
pub fn revoke_approved_root(app: tauri::AppHandle, path: String) -> Result<(), String> {
    approval::revoke(&app, &path)
}

#[cfg(test)]
mod tests {
    /// 피커는 다이얼로그를 열므로 정상 인자로는 테스트에서 부를 수 없다. 대신
    /// **인자를 일부러 틀리게** 보내 역직렬화 단계에서 끊는다 — 그것만으로도
    /// "generate_handler에 등록돼 있고 인자 이름이 맞다"가 고정된다. 커맨드 이름 오타나
    /// 등록 누락은 다른 메시지("not found")를 내므로 이 단정이 구분한다.
    #[test]
    fn pick_approved_dir_is_registered_and_takes_a_purpose_arg() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![super::pick_approved_dir])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");

        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "pick_approved_dir".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                // purpose는 String인데 숫자를 보낸다 → 핸들러 본문 이전에 실패한다.
                body: tauri::ipc::InvokeBody::Json(serde_json::json!({ "purpose": 123 })),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        let err = res.expect_err("잘못된 인자 타입은 거부되어야 한다");
        let msg = err.to_string();
        assert!(
            !msg.contains("not found"),
            "커맨드가 generate_handler에 등록되지 않았다: {msg}"
        );
        assert!(
            msg.contains("purpose"),
            "인자 역직렬화 단계에 도달하지 못했다: {msg}"
        );
    }
}
