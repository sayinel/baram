// External file drag & drop hook — Tauri onDragDropEvent (OS-level file drop)
// Feature 1: External files → FileTree (copy to project)
// Feature 2: External images → Editor (copy to assets/, insert image node)
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

import { isWysiwygVimModal } from "../extensions/plugins/vim/vim-keys";
import { createDir, importFile, listDir } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import {
  hideDropIndicator,
  insertNodeAtPos,
  removeDropIndicator,
  resolveInsertTarget,
  showDropIndicator,
} from "../utils/editor/drop-indicator";
import { registerEditorMutationTask } from "../utils/editor/mutation-tasks";
import { logger } from "../utils/logger";
import { isImageFile, resolveNameConflict } from "../utils/path-utils";

interface UseExternalDropOptions {
  editor: Editor | null;
}

/** True while a native OS file drag is active (Tauri onDragDropEvent). */
export let isExternalFileDrag = false;

// --- Zone detection via bounding rects ---

type DropZone = "editor" | "filetree" | null;

export function useExternalDrop({ editor }: UseExternalDropOptions) {
  useEffect(() => {
    // Guard flag: set to false on cleanup so stale async Tauri listeners
    // (registered before editor was ready) become no-ops.
    let isCurrent = true;
    let unlisten: (() => void) | null = null;

    // Browser dragover listener — shows drop indicator using continuous
    // browser events (Tauri "over" events alone can be too infrequent).
    const handleBrowserDragOver = (e: DragEvent) => {
      if (!isExternalFileDrag || !editor) return;
      e.preventDefault(); // Required to allow drop
      const zone = detectZone(e.clientX, e.clientY);
      clearAllHighlights();
      if (zone === "editor") {
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

          if (zone === "filetree") {
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

function clearAllHighlights() {
  document
    .querySelectorAll(".file-tree-ext-drop-target")
    .forEach((e) => e.classList.remove("file-tree-ext-drop-target"));
  hideDropIndicator();
}

// --- Highlight helpers ---

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

// --- Hook ---

async function handleEditorDrop(
  paths: string[],
  editor: Editor,
  insertPos: number,
) {
  const imagePaths = paths.filter(isImageFile);
  if (!imagePaths.length) return;

  const { activeTabId, tabs } = useEditorStore.getState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab?.filePath) return;

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

  // §298 §12-9b (design §5c): each awaited importFile is an async gap — the
  // copy may finish, but a dead task must not insert into the editor.
  const task = registerEditorMutationTask(editor.view);
  try {
    for (const sourcePath of imagePaths) {
      const originalName = sourcePath.split("/").pop() ?? "";
      if (!originalName) continue;

      const finalName = resolveNameConflict(originalName, existingNames);
      const destPath = assetsDir + "/" + finalName;

      try {
        await importFile(sourcePath, destPath);
        existingNames.add(finalName);
        if (!task.isLive()) return;

        const relativeSrc = "./assets/" + finalName;
        const alt = finalName.replace(/\.[^.]+$/, "");

        const imageNode = editor.state.schema.nodes.image.create({
          src: relativeSrc,
          alt,
        });
        pos = insertNodeAtPos(editor, pos, imageNode);
      } catch (err) {
        logger.error("[ExternalDrop] Image drop failed:", err);
      }
    }
  } finally {
    task.finish();
  }
}

// --- Drop handlers ---

async function handleFileTreeDrop(paths: string[], el: Element | null) {
  const { rootPath, addFileEntry } = useFileStore.getState();
  if (!rootPath) return;

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
    const originalName = sourcePath.split("/").pop() ?? "";
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
    }
  }
}

function hitTestRect(el: Element | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
