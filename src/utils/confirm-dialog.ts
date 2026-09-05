// Custom confirm dialog — replaces window.confirm() which doesn't work in Tauri WKWebView
// Pattern from showPrompt() in ai-commands.ts

import { restoreFocus } from "./restore-focus";

/**
 * 확인 대화상자의 성격. 기본값은 **파괴적 조작**이다 — 이 헬퍼가 그것을 위해 태어났고
 * 호출부 다섯이 여전히 그쪽이기 때문이다(파일/폴더 삭제, 태스크 줄 삭제, Zettel 휴지통,
 * 하이라이트 삭제).
 *
 * ‼️ 기본값을 그대로 쓰면 확인 버튼에 **"Delete"**가 적힌다. "옮길까요?"·"조정할까요?"
 * 처럼 지우지 않는 조작에서 그 문구는 단순한 오탈자가 아니라 **사용자가 취소를 누르게
 * 만든다** — 실제로 §312 아카이브가 그렇게 아무것도 하지 못했다.
 */
export interface ConfirmOptions {
  /** 취소 버튼 문구. 기본 "Cancel" — i18n된 메시지를 넘기는 호출부는
   *  `t("common.cancel")`을 함께 넘겨 버튼만 영어로 남지 않게 한다 (issue 523). */
  cancelLabel?: string;
  /** 확인 버튼 문구. 기본 "Delete" */
  confirmLabel?: string;
  /** 확인 버튼을 위험색으로 그릴지. 기본 true */
  danger?: boolean;
}

/** 단일 확인 버튼 알림 — 일괄 작업 실패 보고용 (§4.3) */
export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const returnFocusTo = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "ai-prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "ai-prompt-dialog";

    const label = document.createElement("p");
    label.className = "ai-prompt-label";
    label.textContent = message;

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const okBtn = document.createElement("button");
    okBtn.className = "ai-prompt-btn";
    okBtn.textContent = "OK";

    btnRow.appendChild(okBtn);
    dialog.appendChild(label);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
    };

    const cleanup = (): void => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      restoreFocus(returnFocusTo);
      resolve();
    };

    okBtn.addEventListener("click", cleanup);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup();
    });
    document.addEventListener("keydown", handleKeydown);

    requestAnimationFrame(() => okBtn.focus());
  });
}

export function showConfirm(
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  const {
    cancelLabel = "Cancel",
    confirmLabel = "Delete",
    danger = true,
  } = options;
  return new Promise((resolve) => {
    const returnFocusTo = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "ai-prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "ai-prompt-dialog";

    const label = document.createElement("p");
    label.className = "ai-prompt-label";
    label.textContent = message;

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ai-prompt-btn ai-prompt-btn-cancel";
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement("button");
    confirmBtn.className = danger
      ? "ai-prompt-btn confirm-dialog-btn-danger"
      : "ai-prompt-btn";
    confirmBtn.textContent = confirmLabel;

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(label);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // ‼️ §277.2 R1 Enter는 **포커스된 버튼**을 따른다. 예전에는 어디서 눌리든
    // 무조건 확인(cleanup(true))이었는데, 이 리스너는 document에 달려 있고
    // 아래에서 포커스를 Cancel에 준다 — 즉 화면은 "취소가 기본"이라고 말하면서
    // Enter는 반대로 동작했다. showConfirm의 네 호출부(파일/폴더 삭제, Zettel
    // 휴지통, 하이라이트 완전 삭제)가 전부 파괴적이고 되돌릴 수 없는 것도
    // 있으므로, 어긋나는 쪽은 Enter다.
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(document.activeElement === confirmBtn);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      }
    };

    const cleanup = (value: boolean) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      restoreFocus(returnFocusTo);
      resolve(value);
    };

    confirmBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener("keydown", handleKeydown);

    requestAnimationFrame(() => cancelBtn.focus());
  });
}
