import type { ProgressiveLoadHandle } from "../../utils/editor/progressive-load";
import type { KeepalivePool } from "../use-large-doc-keepalive";
// §298 split-review §2 — shared context for the tab-switching effect's branches.
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { notifyFileOpen } from "../../plugins/plugin-lifecycle";
import { markContentLoaded } from "../../utils/editor/programmatic-update";

/**
 * Bundles the state every extracted branch of `useTabSwitching`'s effect needs, so
 * moving a branch to its own file doesn't turn it into a function with a dozen
 * positional parameters.
 *
 * ‼️ `activeTabId` is deliberately NOT a field here — every branch function takes it
 * (or the id it already resolved, e.g. `incomingTab.id`) as an explicit parameter
 * instead. The pre-split effect closed over `activeTabId` directly in several places
 * (§298 리뷰 리스크 2); putting it on this shared, effect-lifetime object would
 * reintroduce exactly that closure-capture hazard one level removed.
 */
export interface TabSwitchContext {
  /** [NEW-MODERATE-C] Shared ref for progressive append handles — also used
   *  by useSourceMode so cancelInflightAppend covers source-mode fills. */
  appendHandleRef: React.MutableRefObject<null | {
    handle: ProgressiveLoadHandle;
    tabId: string;
  }>;
  /** §perf-large-file C3.5: factory to create a keep-alive editor for a tab */
  createKeepaliveEditor: () => Editor;
  /** Non-null here — every branch only runs after the effect's `if (!editor) return;` guard. */
  editor: Editor;
  /** Per-tab EditorState cache — owned by useSourceMode, shared here */
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  getSourceBuffer: (tabId: string) => string;
  /**
   * §260 Phase 4b — the ONLY way a branch may mark content installed. Bundles
   * `markContentLoaded` with the matching `notifyFileOpen`, which every install site
   * called right alongside it (289-290/435-436/544-545 in the pre-split file). A
   * branch that installs content and forgets this call leaves the plugin editor
   * surface refusing reads/writes for that tab forever (§298 리뷰 리스크 5).
   *
   * ‼️ Not universal — the non-markdown source-buffer branch calls `notifyFileOpen`
   * WITHOUT marking content loaded (there is no ProseMirror doc to guard), and the
   * empty/no-active-tab branch calls neither. Both stay inline rather than going
   * through this wrapper.
   */
  installContent: (tabId: string, filePath: string) => void;
  /** §perf-large-file C3.5: keep-alive editor pool for large documents */
  keepalive: KeepalivePool;
  /** §perf-large-file C3.5: notify App of the active editor change */
  onActiveEditorChange: (editor: Editor | null) => void;
  /** §perf-large-file B2/C2: cancellation token for the in-flight async parse +
   *  progressive load. Shared with the effect's cleanup, which flips `.cancelled`
   *  on the SAME ref object — never recreate it inside a branch. */
  progressiveLoadRef: React.MutableRefObject<{ cancelled: boolean }>;
  /**
   * §291 탭별 스크롤 오프셋 — **기록은 MarkdownSurface의 scroll 리스너가 한다.**
   * 여기서는 읽기만 한다(원본 파라미터 문서 참조: `use-tab-switching.ts`).
   */
  scrollOffsets: React.MutableRefObject<Map<string, number>>;
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
  setIsParsing: (v: boolean) => void;
  setSourceBuffer: (tabId: string, content: string) => void;
  /** §287 소스 모드인 탭들 — `useSourceMode` 소유 prop이지 store 값이 아니다. */
  sourceModeTabs: ReadonlySet<string>;
}

/** The one and only implementation of `TabSwitchContext.installContent`. */
export function installContent(tabId: string, filePath: string): void {
  markContentLoaded(tabId);
  if (filePath) notifyFileOpen(filePath);
}
