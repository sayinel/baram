// §56l Quick Capture Dialog — Cmd+Shift+N
import { useCallback, useEffect, useState } from "react";

import { EditorContent } from "@tiptap/react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import {
  formatKeyForDisplay,
  normalizeKeyEvent,
} from "../../keybindings/key-utils";
import { TASK_INPUT_COMMAND } from "../../keybindings/keybinding-registry";
import { findCommandByKey } from "../../keybindings/use-keybindings";
import { captureFleeting } from "../../services/zettelkasten-service";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { resolveZettelDir } from "../../utils/zettelkasten/zettelkasten";
import { TagSuggest } from "./TagSuggest";
import { useCaptureEditor } from "./use-capture-editor";
import { useCaptureResize } from "./use-capture-resize";
import { useCaptureTags } from "./use-capture-tags";
import { captureErrorKey, useCaptureTaskMode } from "./use-capture-task-mode";

// ⌘↩ on macOS, Ctrl+Enter elsewhere — shown on the Save button.
const saveKeyLabel = formatKeyForDisplay(
  "Mod+Enter",
  navigator.platform.includes("Mac"),
);

export function QuickCaptureDialog() {
  const { t } = useTranslation();
  // ‼️ bare `useUIStore()` subscribes to the whole store, so an unrelated UI change re-renders
  // the dialog — and re-renders it while the user is typing into it.
  const { quickCaptureOpen, quickCaptureTaskIntent, toggleQuickCapture } =
    useUIStore(
      useShallow((s) => ({
        quickCaptureOpen: s.quickCaptureOpen,
        quickCaptureTaskIntent: s.quickCaptureTaskIntent,
        toggleQuickCapture: s.toggleQuickCapture,
      })),
    );
  // §99 M4: reactive read so the "space not configured" hint / disabled Save
  // surface immediately on open/render, not only after a failed save attempt.
  const keybindingOverrides = useSettingsStore((s) => s.keybindingOverrides);
  const { zettelkastenEnabled, zettelkastenDirectory } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
    })),
  );
  const rootPath = useFileStore((s) => s.rootPath);
  const zettelDir = resolveZettelDir(rootPath, zettelkastenDirectory);
  const zettelReady = zettelkastenEnabled && !!zettelDir;
  const taskMode = useCaptureTaskMode();
  const tags = useCaptureTags(quickCaptureOpen);
  const resize = useCaptureResize();
  // §323 본문은 이제 문서창과 같은 엔진의 편집기가 들고 있다 — `body` state는 없다.
  const capture = useCaptureEditor(quickCaptureOpen);
  const [source, setSource] = useState("");
  const [saveError, setSaveError] = useState("");

  const { reset: resetTaskMode } = taskMode;
  useEffect(() => {
    if (!quickCaptureOpen) return;

    setSource("");
    setSaveError("");
    // §307D 리뷰 Minor 6: 다이얼로그는 언마운트되지 않고 `null`을 반환하므로 태스크
    // 모드가 살아남는다. 출처·태그와 같이 매번 되돌린다 — 캡처는 매번 새 결정이고,
    // 끈적이는 숨은 모드는 다음 메모를 소리 없이 수집함의 한 줄로 만든다. 본문은
    // `useCaptureEditor`가 open 전환마다 새 인스턴스를 만들어 스스로 비운다.
    // §313 전역 캡처로 열렸으면 태스크 모드로 시작한다. 그 외에는 꺼진 상태다.
    resetTaskMode(quickCaptureTaskIntent);
  }, [quickCaptureOpen, quickCaptureTaskIntent, resetTaskMode]);

  // 다이얼로그가 열릴 때 편집기로 포커스를 옮긴다 — 예전 textarea의 자동 포커스와
  // 같은 계약. 편집기 인스턴스는 `useCaptureEditor`의 effect 안에서 비동기로(다음
  // 렌더에) 만들어지므로, 인스턴스 자체를 의존성으로 삼아야 준비된 시점에 잡힌다.
  const { editor: captureEditorInstance } = capture;
  useEffect(() => {
    captureEditorInstance?.commands.focus();
  }, [captureEditorInstance]);

  const handleSave = useCallback(async () => {
    setSaveError("");

    if (capture.isEmpty) {
      setSaveError(t("journal.capture.error.empty"));
      return;
    }

    const body = capture.getMarkdown();

    // §307D 태스크 모드는 Zettel 공간을 요구하지 않는다 — 수집함 파일에
    // 한 줄을 붙이는 것뿐이므로 아래 Zettel 가드보다 먼저 갈라진다.
    if (taskMode.enabled) {
      try {
        // 태그는 캡처 줄에 인라인으로 접힌다. 여기서 버리면 자동완성이 제안하는
        // `#someday`가 아무 데도 닿지 않아, 정리 어휘가 캡처 지점에서 끊긴다.
        await taskMode.save(body, tags.list);
      } catch (err) {
        logger.error("[QuickCapture] Task capture failed:", err);
        // 다이얼로그는 열린 채로 둔다 — 본문은 다른 어디에도 없다.
        setSaveError(t(captureErrorKey(err)));
        return;
      }
      toggleQuickCapture();
      return;
    }

    // §99 M4: the Save button is disabled while !zettelReady, but keep this
    // check as a defense-in-depth guard (e.g. Enter key submit).
    if (!zettelReady || !zettelDir) {
      setSaveError(t("journal.capture.error.noSpace"));
      return;
    }

    try {
      // Compose the fleeting body — §99 A: tags go to the frontmatter `tags:`
      // array, not inline in the body.
      const bodyLines: string[] = [];
      if (body) bodyLines.push(body, "");
      // ‼️ Not translated: this line is written into the note on disk, not shown in the UI.
      // A localised key here would make the saved file's format depend on the app language.
      if (source) bodyLines.push(`Source: ${source}`, "");

      const result = await captureFleeting(
        zettelDir,
        bodyLines.join("\n").trim(),
        tags.list,
      );
      if (!result) {
        setSaveError(t("journal.capture.error.inbox"));
        return;
      }

      toggleQuickCapture();
    } catch (err) {
      logger.error("[QuickCapture] Save failed:", err);
      setSaveError(
        t("journal.capture.error.save", {
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }, [
    capture,
    source,
    tags.list,
    zettelReady,
    zettelDir,
    taskMode,
    toggleQuickCapture,
    t,
  ]);

  // Data-loss guard: with anything typed, only the Cancel button (or a
  // successful save) may dismiss the dialog — not outside clicks or Escape.
  const hasContent = !!(!capture.isEmpty || source.trim() || tags.value.trim());

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Plain Enter inserts a new line/paragraph in the memo editor; save is
      // Mod+Enter. This handler sits on the dialog container, and keys typed
      // into the editor still reach it by bubbling — §323 kept that wiring.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Korean IME: Enter during composition commits the syllable.
        // Do NOT preventDefault or save — let the IME finish naturally.
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        handleSave();
      }
      // §307D 태스크 모드 토글 — IME 조합 중에는 같은 이유로 무시한다.
      //
      // 수정자를 손으로 비교하지 않고 `normalizeKeyEvent`를 쓰는 이유 두 가지:
      // (1) macOS에서 ⌥+문자는 특수문자를 만들어 `e.key`가 "t"가 아니라 "†"다.
      //     이 헬퍼는 `e.code`(레이아웃 독립)로 판정한다.
      // (2) 사용자가 설정에서 바꾼 조합이 실제로 동작한다 — 하드코딩하면
      //     레지스트리에 등록해 놓고 핸들러가 그 값을 무시하게 된다.
      if (!e.nativeEvent.isComposing) {
        const notation = normalizeKeyEvent(
          e.nativeEvent,
          navigator.platform.includes("Mac"),
        );
        if (
          notation &&
          findCommandByKey(notation, keybindingOverrides)?.id ===
            TASK_INPUT_COMMAND
        ) {
          e.preventDefault();
          taskMode.toggle();
          return;
        }
      }
      if (e.key === "Escape") {
        if (hasContent) return;
        toggleQuickCapture();
      }
    },
    [handleSave, toggleQuickCapture, hasContent, taskMode, keybindingOverrides],
  );

  const handleOverlayClick = useCallback(() => {
    if (hasContent) return;
    toggleQuickCapture();
  }, [hasContent, toggleQuickCapture]);

  if (!quickCaptureOpen) return null;

  return (
    <div className="quick-capture-overlay" onClick={handleOverlayClick}>
      <div
        className="quick-capture-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-capture-header">
          <h3>{t("journal.capture.title")}</h3>
          <label className="quick-capture-task-toggle">
            <input
              checked={taskMode.enabled}
              onChange={taskMode.toggle}
              type="checkbox"
            />
            {t("journal.capture.taskMode.label")}
          </label>
        </div>

        {/* Body — §323 문서창과 같은 엔진. `_editor` 핸들은 테스트가 jsdom에서
            내용을 직접 넣기 위한 통로다(contenteditable 타이핑은 신뢰할 수 없다). */}
        <div
          className="quick-capture-editor"
          ref={(el) => {
            if (el) {
              (el as HTMLElement & { _editor?: unknown })._editor =
                capture.editor;
            }
          }}
          style={{ height: `${resize.height}px` }}
        >
          <EditorContent editor={capture.editor} />
        </div>

        {/* §324-g 드래그로 편집기 높이를 조정한다. */}
        <div
          className="quick-capture-resize"
          onMouseDown={resize.onResizeMouseDown}
        />

        {/* Optional source. §18.0: a task is a line and is never promoted to a
            note, so it has nowhere to carry a source URL — the field would take
            input and drop it. Tags do fold into the line, so they stay. */}
        {!taskMode.enabled && (
          <input
            className="quick-capture-input"
            onChange={(e) => setSource(e.target.value)}
            placeholder={t("journal.capture.source.placeholder")}
            type="text"
            value={source}
          />
        )}

        {/* Tags with autocomplete */}
        <div className="quick-capture-tags-wrap">
          <input
            className="quick-capture-input"
            onBlur={tags.onBlur}
            onChange={tags.onChange}
            onKeyDown={tags.onKeyDown}
            placeholder={t("journal.capture.tags.placeholder")}
            ref={tags.inputRef}
            type="text"
            value={tags.value}
          />
          <TagSuggest
            activeIndex={tags.activeIndex}
            onSelect={tags.onSelect}
            query={tags.query}
            tags={tags.index}
            visible={tags.visible}
          />
        </div>

        {/* §99 M4: surface the "space not configured" state immediately on
            render, not only after a failed save attempt. §307D: task mode
            doesn't use the Zettel space, so this hint doesn't apply to it. */}
        {!zettelReady && !taskMode.enabled && (
          <div className="quick-capture-error">
            {t("journal.capture.error.noSpace")}
          </div>
        )}

        {/* Error message */}
        {saveError && <div className="quick-capture-error">{saveError}</div>}

        {/* Actions */}
        <div className="quick-capture-actions">
          <button className="quick-capture-cancel" onClick={toggleQuickCapture}>
            {t("common.cancel")}
          </button>
          <button
            className="quick-capture-save"
            disabled={capture.isEmpty || (!zettelReady && !taskMode.enabled)}
            onClick={handleSave}
          >
            {t("journal.capture.save", { key: saveKeyLabel })}
          </button>
        </div>
      </div>
    </div>
  );
}
