// External file drag & drop hook — Tauri onDragDropEvent (OS-level file drop)
// Feature 1: External files → FileTree (copy to project)
// Feature 2: External images/videos → Editor (copy to assets/, insert image/video node, §297)
// Feature 3: External images/videos → the open Quick Capture dialog (§324-e)
//
// ‼️ Why the capture dialog is handled HERE and not by its own editor: an OS
// file drag never reaches ProseMirror's `handleDrop` at all — Tauri intercepts
// it natively, and `drop-handler.ts` bails on `isExternalFileDrag` for exactly
// that reason. Paste and drop into the same capture box therefore travel two
// completely separate mechanisms, which is how drop stayed broken while every
// paste test was green.
//
// Coordinate handling:
// wry's macOS drag_drop.rs gets NSView points (= CSS logical pixels) from
// draggingLocation(), casts to i32, and passes as a tuple. tauri-runtime-wry
// wraps this tuple in PhysicalPosition WITHOUT multiplying by scale factor.
// So despite the "PhysicalPosition" type name, the values are already in
// CSS/logical pixels. We must NOT divide by devicePixelRatio.
//
// Zone detection uses bounding rects (not elementFromPoint) for reliable
// boundary detection — the 3px Splitter between sidebar and editor causes
// elementFromPoint to miss both zones at the boundary.
import { useEffect } from "react";

import { getCurrentWebview } from "@tauri-apps/api/webview";

import type { CaptureDropAccess } from "../stores/editor/editor";
import type { Editor } from "@tiptap/core";

import { isWysiwygVimModal } from "../extensions/plugins/vim/vim-keys";
import { type Locale, t } from "../i18n";
import { createDir, importDir, importFile, listDir } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";
import {
  hideDropIndicator,
  insertNodeAtPos,
  removeDropIndicator,
  resolveInsertTarget,
  showDropIndicator,
} from "../utils/editor/drop-indicator";
import { registerEditorMutationTask } from "../utils/editor/mutation-tasks";
import { logger } from "../utils/logger";
import { classifyMediaSrc, isMediaFilePath } from "../utils/media-src";
import { basename, dirname, resolveNameConflict } from "../utils/path-utils";

interface UseExternalDropOptions {
  editor: Editor | null;
}

/** True while a native OS file drag is active (Tauri onDragDropEvent). */
export let isExternalFileDrag = false;

// --- Zone detection via bounding rects ---

type DropZone = "capture" | "editor" | "filetree" | null;

// --- Drop handlers ---

/**
 * §297 OS 드래그(Finder 등)로 들어온 파일을 에디터에 삽입한다.
 *
 * 이미지·동영상 모두 여기서 다룬다 — 노드 타입은 `classifyMediaSrc`(§293, 유일한
 * 미디어 분류 열거)로 정한다.
 *
 * §297 fix (R1): 이전에는 확장자 사전 필터가 없었다 — video/image가 아닌 다른
 * 확장자는 `classifyMediaSrc`의 기본값인 "image"로 떨어져 그대로 진행했고,
 * `.pdf`/`.zip`/`.docx`를 에디터에 드롭하면 assets/에 복사되고 깨진 이미지
 * 노드가 생겼다(회귀 — 이전에는 조용히 무시됐다). `classifyMediaSrc`의 "image"
 * fallback은 `![]("아무 확장자")` 같은 마크다운 문맥에서는 옳은 답이라 그 함수
 * 자체는 바꾸지 않는다 — "이 파일이 미디어인가"라는 다른 질문에는
 * `isMediaFilePath`(§293, 같은 두 확장자 목록에서 합성)로 답해, 인식 못 하는
 * 확장자는 예전처럼 무시한다.
 *
 * ‼️ §297 fix (I-3 final-gate Important #1): 이 함수는 `media-copy.ts`의
 * `copyBytesToDir`를 쓰지 않는다 — 쓸 수 없다. 여기 들어오는 파일은 이미
 * 디스크에 있는 실제 경로(`sourcePath`)이고 Rust `import_file`이 경로→경로
 * 복사를 한다; `copyBytesToDir`는 메모리 바이트(`Uint8Array`)를 받아
 * `writeBinaryFile`로 쓴다 — IPC 모양 자체가 다르다. 그래서 정책은 여기서
 * 독립적으로 유지한다: `listDir`을 루프 **밖에서 한 번만** 부르고, 루프
 * **안에서 각 파일의 `importFile`을 await**한 뒤 `existingNames`에 추가한다
 * — drop-handler.ts의 두 루프가 파일마다 await 없이 `.then()`을 쏘던 것과
 * 달리, 이 함수는 처음부터 순차적이었다(그래서 그 동시성 결함이 여기엔
 * 없었다). 두 진입 표면이 "같은 정책"이라는 말은 API 모양이 같다는 뜻이
 * 아니라 결과(경합 없는 이름 충돌 해소)가 같다는 뜻이다.
 *
 * §324-e `resolveDestinationPath`는 붙여넣기 경로(`DropHandler`의 같은 이름 옵션,
 * `drop-handler.ts`의 `getJournalContext` 주석에 세 상태가 적혀 있다)와 **같은
 * 계약**이다. 두 표면이 같은 답을 내야 하므로 계약도 하나여야 한다:
 *  - 아예 안 넘김(`undefined`/`null`) → 이것은 문서 편집기다. 활성 탭을 본다
 *    (이 옵션이 생기기 전과 완전히 동일).
 *  - 넘겼고 경로를 돌려줌 → 그 경로 옆 `assets/`에 저장한다.
 *  - 넘겼고 `null`을 돌려줌 → 호스트가 목적지의 유일한 권위자인데 지금 목적지가
 *    없다. 활성 탭으로 **새지 않는다** — 그 폴백이 정확히 이 옵션이 막으려는
 *    결함이다. 아래 "목적지 없음" 분기로 간다.
 *
 * ‼️ 붙여넣기 경로의 자기완결형 route(이미지 = data URL)가 여기에는 없다.
 * 붙여넣기는 바이트를 손에 들고 있지만 여기 들어오는 것은 **볼트 외부**의 디스크
 * 경로뿐이고, 그 바이트를 읽을 수 있는 커맨드는 전부 볼트에 갇혀 있어(Finder의
 * 파일을 읽지 못한다) data URL을 만들 방법 자체가 없다. 그래서 목적지가 없으면
 * 저장하지 않고 알린다 — 조용한 실패도, 엉뚱한 디렉터리도 아니다.
 *
 * @internal — exported for the §12-9 race tests only.
 */
export async function handleEditorDrop(
  paths: string[],
  editor: Editor,
  insertPos: number,
  resolveDestinationPath?: (() => null | string) | null,
) {
  // §297 fix (M1): filter BEFORE touching the filesystem, not inside the
  // loop below. A prior version filtered inside the loop, so a drop with
  // nothing recognized (e.g. a lone `.pdf`) still ran createDir + listDir —
  // leaving a stray empty `assets/` folder next to the document where before
  // this regression it left nothing.
  const mediaPaths = paths.filter(isMediaFilePath);
  if (!mediaPaths.length) return;

  const docPath = resolveDestinationPath
    ? resolveDestinationPath()
    : activeTabFilePath();

  // §297 fix (M-9, whole-branch review): this used to return here with no
  // toast, while the paste path (drop-handler.ts's insertVideoFromBytes)
  // toasts video.noDocumentPath for the exact same condition — same user
  // intent (drop a media file into an unsaved doc), two different outcomes
  // depending on which surface the file arrived through. Checked AFTER the
  // media filter above so an unsaved-doc drop of something that isn't media
  // anyway still no-ops silently, matching M1's own reasoning.
  //
  // §324-e 캡처 호스트가 `null`을 돌려준 경우도 여기로 온다 — 문구가 "문서가
  // 저장되지 않았다"인 것은 두 경우 모두 같은 사실을 말한다: 상대경로를 걸어 둘
  // 파일이 아직 없다.
  if (!docPath) {
    toast("video.noDocumentPath", { name: basename(mediaPaths[0]) }, "error");
    return;
  }

  // 붙여넣기 경로의 `saveMediaToDocAssets`와 같은 유도식(`dirname(docPath)`)을
  // 쓴다 — 두 표면이 같은 파일에 대해 다른 assets/를 고르면 안 된다.
  const assetsDir = dirname(docPath) + "/assets";

  // §298 §12-9b (design §5c): register BEFORE the first await. assetsDir and
  // insertPos are bound to THIS tab; registering only after createDir/listDir
  // would leave a state install during those IPC calls with nothing to
  // invalidate, and the continuation would then register into the new
  // generation — copying into tab A's assets dir and inserting an
  // A-relative image at a stale position inside tab B.
  const task = registerEditorMutationTask(editor.view);
  try {
    try {
      await createDir(assetsDir);
    } catch {
      // May already exist
    }
    if (!task.isLive()) return;

    let existingNames: Set<string>;
    try {
      const entries = await listDir(assetsDir);
      existingNames = new Set(entries.map((e) => e.name));
    } catch {
      existingNames = new Set();
    }
    if (!task.isLive()) return;

    let pos = insertPos;

    for (const sourcePath of mediaPaths) {
      // Re-check per iteration, not only after a SUCCESSFUL import: a
      // rejected import lands in the catch below, which would otherwise let
      // the loop start copying the next file into the previous tab's
      // assets dir long after the task died (§12-9b).
      if (!task.isLive()) return;

      const originalName = basename(sourcePath);
      if (!originalName) continue;

      const isVideo = classifyMediaSrc(sourcePath) === "video-file";
      const nodeType = editor.state.schema.nodes[isVideo ? "video" : "image"];
      // 스키마에 해당 노드가 없으면(예: 축소된 테스트 스키마) 건너뛴다 — throw하지
      // 않는다. insertMediaAtPos(drop-handler.ts)의 같은 방어와 동일한 이유.
      if (!nodeType) continue;

      const finalName = resolveNameConflict(originalName, existingNames);
      const destPath = assetsDir + "/" + finalName;

      try {
        await importFile(sourcePath, destPath);
        existingNames.add(finalName);
        if (!task.isLive()) return;

        const relativeSrc = "assets/" + finalName;
        const alt = finalName.replace(/\.[^.]+$/u, "");

        const mediaNode = nodeType.create({ src: relativeSrc, alt });
        pos = insertNodeAtPos(editor, pos, mediaNode);
      } catch (err) {
        logger.error("[ExternalDrop] Media drop failed:", err);
        if (isVideo) {
          // §297 동영상 저장 실패는 조용한 실패로 두지 않는다 — 이미지는 기존
          // 동작(logger.error만)을 그대로 유지한다.
          toast("video.saveFailed", { name: originalName }, "error");
        }
      }
    }
  } finally {
    task.finish();
  }
}

export async function handleFileTreeDrop(paths: string[], el: Element | null) {
  const { rootPath, addFileEntry } = useFileStore.getState();
  if (!rootPath) return;

  // The folder wrapper encloses its child rows, so `closest` from a file row
  // already resolves to that file's own directory; a top-level row has no
  // wrapper and correctly falls back to the vault root.
  const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
  const targetDir = folderEl?.dataset.dropPath || rootPath;

  let existingNames: Set<string>;
  try {
    const entries = await listDir(targetDir);
    existingNames = new Set(entries.map((e) => e.name));
  } catch {
    existingNames = new Set();
  }

  for (const sourcePath of paths) {
    const originalName = basename(sourcePath);
    if (!originalName) continue;

    const finalName = resolveNameConflict(originalName, existingNames);
    const destPath = targetDir + "/" + finalName;

    try {
      await importFile(sourcePath, destPath);
      existingNames.add(finalName);
      addFileEntry(targetDir, {
        name: finalName,
        path: destPath,
        isDir: false,
      });
    } catch (err) {
      logger.error("[ExternalDrop] Copy to FileTree failed:", err);
      // `import_file` is a single-file copy, so a dropped FOLDER always lands
      // here. `import_dir` is what tells the two apart — it returns null for a
      // non-directory. The frontend must NOT probe the source itself: the
      // source is vault-external by design and every command that could
      // inspect it is vault-confined, so any such probe reports "not a
      // directory" for every folder ever dropped.
      await importDroppedFolder(
        sourcePath,
        destPath,
        finalName,
        originalName,
        targetDir,
      );
      existingNames.add(finalName);
    }
  }
}

// --- Hook ---

export function useExternalDrop({ editor }: UseExternalDropOptions) {
  useEffect(() => {
    // Guard flag: set to false on cleanup so stale async Tauri listeners
    // (registered before editor was ready) become no-ops.
    let isCurrent = true;
    let unlisten: (() => void) | null = null;

    // Browser dragover listener — shows drop indicator using continuous
    // browser events (Tauri "over" events alone can be too infrequent).
    const handleBrowserDragOver = (e: DragEvent) => {
      // Only the editor branch needs an editor. Gating the whole handler on it
      // dropped the file-tree highlight whenever no tab was open — the state
      // the app starts in — leaving the sparse Tauri "over" events as the only
      // feedback. Matches the Tauri handler below, which gates per branch.
      if (!isExternalFileDrag) return;
      e.preventDefault(); // Required to allow drop
      const zone = detectZone(e.clientX, e.clientY);
      clearAllHighlights();
      if (zone === "capture") {
        // §324-e vim 가드가 없는 이유: 캡처 편집기의 Extension 세트는
        // `wysiwygVim`을 제외한다(`CAPTURE_EXCLUDED_EXTENSIONS`) — 모드라는
        // 것이 없는 표면이다.
        highlightCaptureDrop(e.clientX, e.clientY);
      } else if (zone === "editor" && editor) {
        // §298 §12-5: vim normal/visual rejects editor-zone file drops
        // (design §5). FileTree drops stay allowed. Highlights are already
        // cleared above, so returning here leaves no stale indicator.
        if (isWysiwygVimModal(editor.state)) return;
        const target = resolveInsertTarget(editor, e.clientX, e.clientY);
        if (target) showDropIndicator(target);
      } else if (zone === "filetree") {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
        if (folderEl) {
          folderEl.classList.add("file-tree-ext-drop-target");
        } else {
          document
            .querySelector(".file-tree")
            ?.classList.add("file-tree-ext-drop-target");
        }
      }
    };

    // Browser drop listener — prevent browser from opening the file.
    const handleBrowserDrop = (e: DragEvent) => {
      if (isExternalFileDrag) {
        e.preventDefault();
      }
    };

    document.addEventListener("dragover", handleBrowserDragOver);
    document.addEventListener("drop", handleBrowserDrop);

    getCurrentWebview()
      .onDragDropEvent((event) => {
        // Skip events from stale listeners (editor was null when registered)
        if (!isCurrent) return;

        const { type } = event.payload;

        if (type === "enter") {
          isExternalFileDrag = true;
        }

        if (type === "enter" || type === "over") {
          // position is already in CSS logical pixels (see header comment)
          const x = event.payload.position.x;
          const y = event.payload.position.y;
          const zone = detectZone(x, y);

          // Clear all first
          clearAllHighlights();

          if (zone === "capture") {
            highlightCaptureDrop(x, y);
          } else if (zone === "filetree") {
            const el = document.elementFromPoint(x, y);
            const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
            if (folderEl) {
              folderEl.classList.add("file-tree-ext-drop-target");
            } else {
              document
                .querySelector(".file-tree")
                ?.classList.add("file-tree-ext-drop-target");
            }
          } else if (zone === "editor" && editor) {
            // §298 §12-5: same modal guard for the Tauri over-path.
            if (isWysiwygVimModal(editor.state)) return;
            const target = resolveInsertTarget(editor, x, y);
            if (target) {
              showDropIndicator(target);
            }
          }
        }

        if (type === "leave") {
          isExternalFileDrag = false;
          clearAllHighlights();
        }

        if (type === "drop") {
          clearAllHighlights();
          const paths = event.payload.paths;
          isExternalFileDrag = false;
          if (!paths.length) return;

          const x = event.payload.position.x;
          const y = event.payload.position.y;
          const zone = detectZone(x, y);

          if (zone === "capture") {
            // §324-e 목적지는 캡처 창이 **자기 리졸버로** 정한다 — 활성 탭이
            // 아니다. 활성 탭에서 유도하면 캡처 노트는 zettel 수집함에,
            // 이미지는 전혀 무관한 열린 문서 옆에 저장돼 상대경로가 어디서도
            // 풀리지 않는다(붙여넣기 경로가 이미 겪은 결함).
            const access = captureDropTarget();
            if (!access) return;
            const target = resolveInsertTarget(access.editor, x, y);
            // 표시줄을 못 구했다고 드랍을 버리지 않는다 — 문서 편집기와 달리
            // 캡처 창은 방금 열린 빈 문서일 수 있다. 그때는 문서 끝에 넣는다.
            handleEditorDrop(
              paths,
              access.editor,
              target?.pos ?? access.editor.state.doc.content.size,
              access.resolveDestinationPath,
            );
          } else if (zone === "filetree") {
            const el = document.elementFromPoint(x, y);
            handleFileTreeDrop(paths, el);
          } else if (zone === "editor" && editor) {
            // §298 §12-5: the drop itself — DOM events cannot cancel the
            // Tauri-native path, so the hook is the only guard point.
            if (isWysiwygVimModal(editor.state)) return;
            const target = resolveInsertTarget(editor, x, y);
            if (target) {
              handleEditorDrop(paths, editor, target.pos);
            }
          }
        }
      })
      .then((fn) => {
        if (isCurrent) {
          unlisten = fn;
        } else {
          // Effect already cleaned up — remove stale listener immediately
          fn();
        }
      });

    return () => {
      isCurrent = false;
      document.removeEventListener("dragover", handleBrowserDragOver);
      document.removeEventListener("drop", handleBrowserDrop);
      unlisten?.();
      isExternalFileDrag = false;
      clearAllHighlights();
      removeDropIndicator();
    };
  }, [editor]);
}

/** 메인 문서 편집기의 활성 탭 경로. 탭이 없거나 저장 전이면 빈 문자열. */
function activeTabFilePath(): string {
  const { activeTabId, tabs } = useEditorStore.getState();
  return tabs.find((t) => t.id === activeTabId)?.filePath ?? "";
}

// --- Highlight helpers ---

/**
 * §324-e 열려 있는 캡처 창의 편집기 접근자 — 없거나 이미 파기됐으면 `null`.
 *
 * `isDestroyed`를 확인하는 이유: 등록 해제는 다이얼로그의 cleanup이 하지만, 이
 * 훅은 그와 다른 시점(네이티브 드래그 이벤트)에 읽는다. 파기된 뷰에 dispatch하면
 * ProseMirror가 던진다.
 */
function captureDropTarget(): CaptureDropAccess | null {
  const access = useEditorStore.getState().captureDropAccess;
  return access && !access.editor.isDestroyed ? access : null;
}

function clearAllHighlights() {
  document
    .querySelectorAll(".file-tree-ext-drop-target")
    .forEach((e) => e.classList.remove("file-tree-ext-drop-target"));
  document
    .querySelectorAll(".capture-ext-drop-target")
    .forEach((e) => e.classList.remove("capture-ext-drop-target"));
  hideDropIndicator();
}

/**
 * §324-e 캡처 창이 드랍을 받는다는 표시. 상자 강조 + 삽입 지점 표시줄 둘 다 —
 * 표시가 없는 드랍 대상은 동작해도 고장 난 것으로 읽힌다.
 *
 * 강조가 따로 있는 이유: 표시줄은 블록 사이의 **한 줄**이라 갓 열린(빈 문단
 * 하나뿐인) 캡처 창에서는 거의 보이지 않는다.
 */
function highlightCaptureDrop(x: number, y: number): void {
  const access = captureDropTarget();
  if (!access) return;
  document
    .querySelector(".quick-capture-editor")
    ?.classList.add("capture-ext-drop-target");
  const target = resolveInsertTarget(access.editor, x, y);
  if (target) showDropIndicator(target);
}

// --- Zone detection helpers ---

function detectZone(x: number, y: number): DropZone {
  // §324-e 캡처 창은 **모달**이다 — 열려 있는 동안 뒤의 편집기와 파일 트리는
  // 클릭도 타이핑도 받지 않으므로, 드랍만 그 뒤로 통과시킬 이유가 없다. 그래서
  // 두 가지를 한 번에 정한다: 다이얼로그 안이면 캡처가 이기고(먼저 히트테스트),
  // 오버레이는 떠 있는데 다이얼로그 밖이면 아무 데도 가지 않는다.
  const overlay = document.querySelector(".quick-capture-overlay");
  if (overlay) {
    return hitTestRect(overlay.querySelector(".quick-capture-dialog"), x, y)
      ? "capture"
      : null;
  }

  // §perf-large-file C3.4: scope to the ACTIVE editor's scroll container
  // so the hidden keep-alive editor's area doesn't intercept drops.
  const editorScroll =
    document.querySelector(".editor-area-scroll[data-editor-active]") ??
    document.querySelector(".editor-area-scroll");
  if (hitTestRect(editorScroll, x, y)) return "editor";
  if (hitTestRect(document.querySelector(".file-tree"), x, y))
    return "filetree";
  return null;
}

function hitTestRect(el: Element | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * §4.3 Copy a dropped folder in, recursively.
 *
 * Reports the outcome either way. Before toasts existed here the only trace of
 * a failure was a `logger.error`, so a drop that could not land looked exactly
 * like one the app never received.
 *
 * Skipped symlinks get their own message rather than being folded into the
 * count: "copied 12 files" would otherwise be a true sentence about an
 * incomplete copy.
 */
async function importDroppedFolder(
  sourcePath: string,
  destPath: string,
  name: string,
  originalName: string,
  targetDir: string,
): Promise<void> {
  try {
    const report = await importDir(sourcePath, destPath);
    if (report === null) {
      // Not a directory — the original single-file copy is the real failure.
      toast("fileTree.drop.failed", { name: originalName }, "error");
      return;
    }
    useFileStore.getState().addFileEntry(targetDir, {
      name,
      path: destPath,
      isDir: true,
    });
    if (report.skippedSymlinks > 0) {
      toast(
        "fileTree.drop.folderCopiedWithSkips",
        {
          count: String(report.copied),
          name,
          skipped: String(report.skippedSymlinks),
        },
        "warning",
      );
    } else {
      toast(
        "fileTree.drop.folderCopied",
        { count: String(report.copied), name },
        "info",
      );
    }
  } catch (err) {
    logger.error("[ExternalDrop] Folder copy failed:", err);
    toast("fileTree.drop.folderFailed", { name }, "error");
  }
}

/** Show a translated toast in the user's current locale. */
function toast(
  key: string,
  params: Record<string, string>,
  type: "error" | "info" | "warning",
): void {
  const { locale } = useSettingsStore.getState();
  useUIStore.getState().showToast(t(key, locale as Locale, params), type);
}
