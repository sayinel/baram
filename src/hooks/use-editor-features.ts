// §4.2 Editor feature subsystems — the 13 hook calls that wire up skills mode,
// auto-save/snapshot, journal cursor, file/task watchers, the global capture
// shortcut, zoom, drag & drop, ghost text, inline AI, settings sync, and the
// close guard. Order matters: see `use-editor-features-order.test.ts`.
import type { UseInlineAIReturn } from "./use-inline-ai";
import type { Editor } from "@tiptap/react";

import { useAutoSave } from "./use-auto-save";
import { useAutoSnapshot } from "./use-auto-snapshot";
import { useCloseGuard } from "./use-close-guard";
import { useExternalDrop } from "./use-external-drop";
import { useFileWatcher } from "./use-file-watcher";
import { useGhostText } from "./use-ghost-text";
import { useGlobalCaptureShortcut } from "./use-global-capture-shortcut";
import { useInlineAI } from "./use-inline-ai";
import { useJournalInitialCursor } from "./use-journal-initial-cursor";
import { useSettingsEffects } from "./use-settings-effects";
import { useSkillsMode } from "./use-skills-mode";
import { useTaskWatcher } from "./use-task-watcher";
import { useZoom } from "./use-zoom";

interface UseEditorFeaturesReturn {
  inlineAI: UseInlineAIReturn;
  isSkill: boolean;
}

export function useEditorFeatures(
  activeEditor: Editor | null,
): UseEditorFeaturesReturn {
  // §72 Skills mode — auto-detect skill files and switch right panel
  const { isSkill } = useSkillsMode();

  // Auto-save hook (markdown files — Tiptap editor.on("update") based)
  // §perf-large-file C3.5: use activeEditor so keep-alive tabs auto-save correctly
  useAutoSave(activeEditor);

  // §56 Place the caret on a body line below the date title when a freshly
  // created journal template loads (instead of at the end of the title).
  useJournalInitialCursor(activeEditor);

  // File system watcher — auto-refresh FileTree on external changes
  useFileWatcher();

  // §304 태스크 캐시 증분 갱신 — file:* 이벤트로 변경된 파일만 재스캔
  useTaskWatcher();

  // §313 전역 캡처 단축키 — 설정된 조합 하나를 OS에 등록해 둔다. 앱에서 **한 번만**
  // 마운트한다(두 번이면 같은 조합을 두 번 등록하려다 실패 상태가 남는다).
  useGlobalCaptureShortcut();

  // §71 Periodic auto-snapshot — fires performAutoSnapshot on the configured interval
  useAutoSnapshot();

  // Page zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
  // §perf-large-file C3.5: zoom against activeEditor's DOM
  useZoom(activeEditor);

  // External file drag & drop — Tauri OS-level file drop (Feature 1 & 2)
  useExternalDrop({ editor: activeEditor });

  // §43 Ghost Text — inline AI completion
  useGhostText(activeEditor);

  // §6.2 Inline AI — Cmd+J editing
  const inlineAI = useInlineAI(activeEditor);

  // Apply settings to DOM (theme, font, spellcheck, locale)
  useSettingsEffects(activeEditor);

  // §close-guard: intercept app close (red X) / quit (Cmd+Q) when tabs are dirty
  useCloseGuard();

  return { inlineAI, isSkill };
}
