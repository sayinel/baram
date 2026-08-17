// Custom confirm dialog — replaces window.confirm() which doesn't work in Tauri WKWebView
// Pattern from showPrompt() in ai-commands.ts

/** 단일 확인 버튼 알림 — 일괄 작업 실패 보고용 (§4.3) */
export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
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

export function showConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
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
    cancelBtn.textContent = "Cancel";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "ai-prompt-btn confirm-dialog-btn-danger";
    deleteBtn.textContent = "Delete";

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(deleteBtn);
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
        cleanup(document.activeElement === deleteBtn);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(false);
      }
    };

    const cleanup = (value: boolean) => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve(value);
    };

    deleteBtn.addEventListener("click", () => cleanup(true));
    cancelBtn.addEventListener("click", () => cleanup(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener("keydown", handleKeydown);

    requestAnimationFrame(() => cancelBtn.focus());
  });
}
