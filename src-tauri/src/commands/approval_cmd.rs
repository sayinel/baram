// §333 게이트 — vault 경계를 넓히는 커맨드가 통과해야 하는 하나의 판정.
//
// ‼️ 다이얼로그는 사실상 `add_context`에서만 뜬다. `vault-context-loader.ts:50,97`의
// 제약 때문에 `addContext`가 `setVaultRoot`보다 먼저 돌고, `set_vault_root`가 도달할 땐
// 이미 승인 상태다. 그 순서를 바꾸면 프롬프트가 두 번 뜬다 (§329.4).

use crate::approval::{self, ApprovalKind, Decision};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// 프런트가 "사용자 거부"와 "진짜 오류"를 가르는 값. 문자열을 바꾸면
/// `src/ipc/approval.ts`의 `isApprovalDeniedError`도 같이 바꿔야 한다.
///
/// ‼️ 두 상수 모두 `src/ipc/__tests__/approval-error-codes.test.ts`가 이 파일의
/// 소스에서 긁어 TS 쪽 리터럴과 대조한다 — 한쪽만 바뀌면 그 테스트가 빨개진다.
/// 상수를 다른 파일로 옮기면 그 테스트의 경로도 같이 옮길 것.
pub const APPROVAL_DENIED: &str = "VAULT_APPROVAL_DENIED";

/// 경로를 해석할 수 없다 — 삭제된 vault, 언마운트된 드라이브, 오타.
///
/// ‼️ `APPROVAL_DENIED`와 **같은 값이면 안 된다.** §333이 전용 코드를 만든 이유가
/// "사용자 거부"와 "진짜 오류"를 가르기 위해서인데, 이 경우를 거부로 보고하면 뜬 적도
/// 없는 다이얼로그에 대해 "허용되지 않았습니다" 토스트가 뜬다 (§335 리뷰 I3).
/// fail-closed 동작은 그대로다 — 보고하는 이유만 다르다.
pub const PATH_UNRESOLVABLE: &str = "VAULT_PATH_UNRESOLVABLE";

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
        Decision::Unresolvable => Err(PATH_UNRESOLVABLE.to_string()),
        Decision::NeedsConfirmation => {
            let canonical = canonical.ok_or_else(|| PATH_UNRESOLVABLE.to_string())?;
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
        // ‼️ Cmd+O는 앱의 기본 "파일 열기"다. 이 둘이 빠지면 .txt·.json·.csv·.yaml·
        // .toml을 **열 수 없다** — 이전 JS 피커(`use-file-operations.ts` handleOpenFile)에
        // 있던 목록이고, Rust 피커로 옮기면서 조용히 사라졌다 (§332 리뷰 I5).
        .add_filter("Text", &["txt", "text"])
        .add_filter("All Files", &["*"])
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

/// §334 다이얼로그 **없이** 승인 여부만 묻는다.
///
/// 시작 시 비활성 컨텍스트를 조용히 재등록할지 정하는 데 쓴다(`use-app-startup.ts`):
/// 이미 승인된 것만 등록하고 미승인은 건너뛰어야, 컨텍스트가 N개일 때 시작하자마자
/// N번 묻는 일이 없다. 확인은 사용자가 실제로 그 컨텍스트로 전환할 때
/// (`switchContext`) 뜬다.
///
/// ‼️ 이 커맨드는 **부여를 하지 않는다** — `covers` 판정을 그대로 돌려주는 순수 질의다.
/// 그래서 프런트가 `covers` 규칙(컴포넌트 단위 prefix + canonicalize)을 두 번째로
/// 열거하지 않아도 된다. 노출되는 정보는 이미 `list_approved_roots`가 주는 것과 같다.
///
/// ‼️ 제네릭 런타임: `ensure_approved`·`pick_approved_dir`와 같은 이유다 —
/// `tauri::test::mock_builder()`(런타임 = `MockRuntime`)가 `generate_handler!`로 이
/// 커맨드를 실제 배선해야 아래 테스트가 등록과 동작을 함께 고정할 수 있다.
#[tauri::command]
pub fn is_path_approved<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: String,
) -> Result<bool, String> {
    let store = approval::load(&app);
    Ok(matches!(
        approval::decide(&store, &path).0,
        Decision::Allowed
    ))
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
    /// ‼️ 두 코드가 같아지면 §333이 만든 구분이 사라진다 — 그리고 그 사고는 "테스트를
    /// 초록으로 만들려고 기대값을 맞추다"가 아니라 **상수를 맞추다** 일어난다. 그래서
    /// 값 자체를 비교하는 단정을 따로 둔다 (§335 리뷰 I3).
    #[test]
    fn the_denial_code_and_the_unresolvable_code_are_different_strings() {
        assert_ne!(super::APPROVAL_DENIED, super::PATH_UNRESOLVABLE);
    }

    /// `is_path_approved`는 다이얼로그를 열지 않으므로 **실제 인자로** IPC를 통과시켜
    /// 답까지 볼 수 있다 — 등록 여부와 동작을 한 테스트가 함께 고정한다.
    /// 해석되지 않는 경로는 `false`여야 한다(fail-closed): 이 값이 true로 새면
    /// 시작 시 미승인 컨텍스트가 조용히 등록된다 (§334).
    #[test]
    fn is_path_approved_is_registered_and_reports_false_for_an_unresolvable_path() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![super::is_path_approved])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app must build");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("mock webview must build");

        let res = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "is_path_approved".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .unwrap(),
                body: tauri::ipc::InvokeBody::Json(
                    serde_json::json!({ "path": "/definitely/not/here/at/all" }),
                ),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );

        let value = res
            .expect("커맨드가 등록돼 있어야 한다")
            .deserialize::<bool>();
        assert!(
            !value.expect("bool이어야 한다"),
            "해석되지 않는 경로는 승인된 것으로 보고되면 안 된다"
        );
    }

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
