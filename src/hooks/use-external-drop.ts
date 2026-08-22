// External file drag & drop hook — Tauri onDragDropEvent (OS-level file drop)
// Feature 1: External files → FileTree (copy to project)
// Feature 2: External images/videos → Editor (copy to assets/, insert image/video node, §297)
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

import type { Editor } from "@tiptap/core";

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
import { logger } from "../utils/logger";
import { classifyMediaSrc, isMediaFilePath } from "../utils/media-src";
import { basename, resolveNameConflict } from "../utils/path-utils";

interface UseExternalDropOptions {
  editor: Editor | null;
}

/** True while a native OS file drag is active (Tauri onDragDropEvent). */
export let isExternalFileDrag = false;

// --- Zone detection via bounding rects ---

type DropZone = "editor" | "filetree" | null;

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
 */
export async function handleEditorDrop(
  paths: string[],
  editor: Editor,
  insertPos: number,
) {
  const { activeTabId, tabs } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // §297 fix (M1): filter BEFORE touching the filesystem, not inside the
  // loop below. A prior version filtered inside the loop, so a drop with
  // nothing recognized (e.g. a lone `.pdf`) still ran createDir + listDir —
  // leaving a stray empty `assets/` folder next to the document where before
  // this regression it left nothing.
  const mediaPaths = paths.filter(isMediaFilePath);
  if (!mediaPaths.length) return;

  // §297 fix (M-9, whole-branch review): this used to return here with no
  // toast, while the paste path (drop-handler.ts's insertVideoFromBytes)
  // toasts video.noDocumentPath for the exact same condition — same user
  // intent (drop a media file into an unsaved doc), two different outcomes
  // depending on which surface the file arrived through. Checked AFTER the
  // media filter above so an unsaved-doc drop of something that isn't media
  // anyway still no-ops silently, matching M1's own reasoning.
  if (!activeTab?.filePath) {
    toast("video.noDocumentPath", { name: basename(mediaPaths[0]) }, "error");
    return;
  }

  const fileDir = activeTab.filePath.substring(
    0,
    activeTab.filePath.lastIndexOf("/"),
  );
  const assetsDir = fileDir + "/assets";

  try {
    await createDir(assetsDir);
  } catch {
    // May already exist
  }

  let existingNames: Set<string>;
  try {
    const entries = await listDir(assetsDir);
    existingNames = new Set(entries.map((e) => e.name));
  } catch {
    existingNames = new Set();
  }

  let pos = insertPos;

  for (const sourcePath of mediaPaths) {
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

      const relativeSrc = "assets/" + finalName;
      const alt = finalName.replace(/\.[^.]+$/, "");

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
      if (zone === "editor" && editor) {
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

          if (zone === "filetree") {
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

          if (zone === "filetree") {
            const el = document.elementFromPoint(x, y);
            handleFileTreeDrop(paths, el);
          } else if (zone === "editor" && editor) {
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

// --- Highlight helpers ---

function clearAllHighlights() {
  document
    .querySelectorAll(".file-tree-ext-drop-target")
    .forEach((e) => e.classList.remove("file-tree-ext-drop-target"));
  hideDropIndicator();
}

// --- Zone detection helpers ---

function detectZone(x: number, y: number): DropZone {
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
