import type { FileEntry } from "../stores/file-store";

import { useAIStore } from "../stores/ai-store";
// §44 AI Chat @reference resolver
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";

export type ReferenceType =
  | "@clipboard"
  | "@current"
  | "@file"
  | "@folder"
  | "@selection";

export interface ResolvedReference {
  content: string;
  label: string;
  type: ReferenceType;
}

export function buildContextPrompt(
  userMessage: string,
  refs: ResolvedReference[],
): string {
  if (refs.length === 0) return userMessage;

  const contextParts = refs.map((r) => `--- ${r.label} ---\n${r.content}`);

  return `Context:\n${contextParts.join("\n\n")}\n\n---\n\nUser message: ${userMessage}`;
}

export function parseReferences(text: string): string[] {
  const refs: string[] = [];
  const regex = /@(selection|current|clipboard|file:[^\s]+|folder:[^\s]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push(`@${match[1]}`);
  }
  return refs;
}

export function resolveReference(ref: string): null | ResolvedReference {
  if (ref === "@selection") {
    const selectionText = useEditorStore.getState().currentSelection;
    return {
      type: "@selection",
      label: "Selection",
      content: selectionText || "[no text selected]",
    };
  }

  if (ref === "@current") {
    const { activeTabId, tabs } = useEditorStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    const content = useFileStore
      .getState()
      .openFiles.get(tab.filePath || tab.id);
    return {
      type: "@current",
      label: tab.title,
      content: content ?? "",
    };
  }

  if (ref === "@clipboard") {
    const clipboardText = useAIStore.getState().clipboardContent;
    return {
      type: "@clipboard",
      label: "Clipboard",
      content: clipboardText || "[empty clipboard]",
    };
  }

  // @file:path
  if (ref.startsWith("@file:")) {
    const path = ref.slice(6);
    const content = useFileStore.getState().openFiles.get(path);
    const name = path.split("/").pop() ?? path;
    return {
      type: "@file",
      label: name,
      content: content ?? `[file: ${path}]`,
    };
  }

  // @folder:path — collect all file paths in the folder
  if (ref.startsWith("@folder:")) {
    const dirPath = ref.slice(8);
    const { fileTree, openFiles } = useFileStore.getState();
    const filePaths = collectFilesInDir(fileTree, dirPath);
    const dirName = dirPath.split("/").pop() ?? dirPath;

    if (filePaths.length === 0) {
      return {
        type: "@folder",
        label: `${dirName}/`,
        content: `[empty folder: ${dirPath}]`,
      };
    }

    // Build content from open files or list paths for files not yet loaded
    const parts: string[] = [];
    for (const fp of filePaths) {
      const fileName = fp.split("/").pop() ?? fp;
      const fileContent = openFiles.get(fp);
      if (fileContent !== undefined) {
        parts.push(`--- ${fileName} ---\n${fileContent}`);
      } else {
        parts.push(`--- ${fileName} ---\n[not loaded: ${fp}]`);
      }
    }

    return {
      type: "@folder",
      label: `${dirName}/ (${filePaths.length} files)`,
      content: parts.join("\n\n"),
    };
  }

  return null;
}

function collectAllFiles(entries: FileEntry[], result: string[]): void {
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.children) {
        collectAllFiles(entry.children, result);
      }
    } else {
      result.push(entry.path);
    }
  }
}

/** Collect all file paths under a directory from the file tree */
function collectFilesInDir(entries: FileEntry[], dirPath: string): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDir) {
      if (entry.path === dirPath) {
        // Found the target dir — collect all descendant files
        collectAllFiles(entry.children ?? [], result);
        return result;
      }
      if (entry.children) {
        const found = collectFilesInDir(entry.children, dirPath);
        if (found.length > 0) return found;
      }
    }
  }
  return result;
}
