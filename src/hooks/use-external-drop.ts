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
import { copyFile, createDir, listDir } from "../ipc/invoke";
import { useFileStore } from "../stores/file-store";
import { useEditorStore } from "../stores/editor-store";
import { isImageFile, resolveNameConflict } from "../utils/path-utils";
import {
  showDropIndicator,
  hideDropIndicator,
  removeDropIndicator,
  resolveInsertTarget,
} from "../utils/drop-indicator";

interface UseExternalDropOptions {
  editor: Editor | null;
}

// --- Zone detection via bounding rects ---

type DropZone = "filetree" | "editor" | null;

function hitTestRect(el: Element | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function detectZone(x: number, y: number): DropZone {
  if (hitTestRect(document.querySelector(".editor-area-scroll"), x, y)) return "editor";
  if (hitTestRect(document.querySelector(".file-tree"), x, y)) return "filetree";
  return null;
}

// --- Highlight helpers ---

function clearAllHighlights() {
  document.querySelectorAll(".file-tree-ext-drop-target").forEach((e) =>
    e.classList.remove("file-tree-ext-drop-target"),
  );
  hideDropIndicator();
}

// --- Hook ---

export function useExternalDrop({ editor }: UseExternalDropOptions) {
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        const { type } = event.payload;

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
              document.querySelector(".file-tree")?.classList.add("file-tree-ext-drop-target");
            }
          } else if (zone === "editor" && editor) {
            const target = resolveInsertTarget(editor, x, y);
            if (target) {
              showDropIndicator(target);
            }
          }
        }

        if (type === "leave") {
          clearAllHighlights();
        }

        if (type === "drop") {
          clearAllHighlights();
          const paths = event.payload.paths;
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
        unlisten = fn;
      });

    return () => {
      unlisten?.();
      clearAllHighlights();
      removeDropIndicator();
    };
  }, [editor]);
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
      await copyFile(sourcePath, destPath);
      existingNames.add(finalName);
      addFileEntry(targetDir, {
        name: finalName,
        path: destPath,
        isDir: false,
      });
    } catch (err) {
      console.error("[ExternalDrop] Copy to FileTree failed:", err);
    }
  }
}

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

  for (const sourcePath of imagePaths) {
    const originalName = sourcePath.split("/").pop() ?? "";
    if (!originalName) continue;

    const finalName = resolveNameConflict(originalName, existingNames);
    const destPath = assetsDir + "/" + finalName;

    try {
      await copyFile(sourcePath, destPath);
      existingNames.add(finalName);

      const relativeSrc = "./assets/" + finalName;
      const alt = finalName.replace(/\.[^.]+$/, "");

      const imageNode = editor.state.schema.nodes.image.create({
        src: relativeSrc,
        alt,
      });
      const tr = editor.state.tr.insert(pos, imageNode);
      editor.view.dispatch(tr);
      pos += imageNode.nodeSize;
    } catch (err) {
      console.error("[ExternalDrop] Image drop failed:", err);
    }
  }
}
