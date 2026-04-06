import type { FileEntry } from "../stores/file/file";

import { listDir } from "../ipc/fs";
import { useAIStore } from "../stores/ai/ai";
import { useContextStore } from "../stores/context/context";
// §44 AI Chat @reference resolver
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";

export type ReferenceType =
  | "@all-vaults"
  | "@clipboard"
  | "@current"
  | "@file"
  | "@folder"
  | "@selection"
  | "@vault"
  | "@vault-context";

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
  const regex =
    /@(selection|current|clipboard|vault:[^\s]+|vault|all-vaults|file:[^\s]+|folder:[^\s]+)/g;
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

  // @vault — placeholder that signals vault-wide knowledge search
  // Actual content is resolved asynchronously via resolveVaultContextReference()
  if (ref === "@vault") {
    return {
      type: "@vault",
      label: "Vault Search",
      content: "[vault search pending]",
    };
  }

  // §87 @vault:CONTEXT_ID — placeholder; resolved async via resolveVaultContextReferences()
  if (ref.startsWith("@vault:")) {
    const contextId = ref.slice(7);
    const ctx = useContextStore
      .getState()
      .contexts.find((c) => c.id === contextId);
    const label = ctx ? `${ctx.label} vault` : "Vault";
    return {
      type: "@vault-context",
      label,
      content: "[vault context pending]",
    };
  }

  // §87 @all-vaults — placeholder; resolved async via resolveVaultContextReferences()
  if (ref === "@all-vaults") {
    return {
      type: "@all-vaults",
      label: "All Vaults",
      content: "[all vaults pending]",
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

/** Korean keyword heuristics that suggest a vault-wide knowledge query */
const VAULT_QUERY_KEYWORDS = [
  "이 프로젝트에서",
  "어디에",
  "찾아줘",
  "검색해",
  "vault에서",
  "전체에서",
  "프로젝트 전체",
];

/**
 * Detect whether a message implies a vault-wide knowledge Q&A query.
 * Returns true if @vault reference is present or Korean keyword heuristics match.
 */
export function isVaultQuery(text: string): boolean {
  const refs = parseReferences(text);
  if (refs.includes("@vault")) return true;
  const lower = text.toLowerCase();
  return VAULT_QUERY_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * §87 Resolve @vault:ID and @all-vaults references asynchronously.
 * Replaces placeholder ResolvedReferences in-place with actual file listing content.
 */
export async function resolveVaultContextReferences(
  refs: ResolvedReference[],
  refStrings: string[],
): Promise<void> {
  const contextStore = useContextStore.getState();

  for (let i = 0; i < refs.length; i++) {
    const refStr = refStrings[i];
    if (!refStr) continue;

    if (refStr.startsWith("@vault:")) {
      const contextId = refStr.slice(7);
      const ctx = contextStore.contexts.find((c) => c.id === contextId);
      if (!ctx) continue;

      try {
        const entries = await listDir(ctx.path, true);
        const fileList = entries
          .filter((e) => !e.isDir && e.name.endsWith(".md"))
          .map((e) => e.path.slice(ctx.path.length + 1))
          .join("\n");
        refs[i] = {
          type: "@vault-context",
          label: `${ctx.label} vault`,
          content: `Files in ${ctx.label}:\n${fileList || "(no markdown files)"}`,
        };
      } catch {
        // Leave placeholder on error
      }
    } else if (refStr === "@all-vaults") {
      const nonFileContexts = contextStore.contexts.filter(
        (c) => c.contextType !== "file",
      );
      const parts: string[] = [];
      for (const ctx of nonFileContexts) {
        try {
          const entries = await listDir(ctx.path, true);
          const fileList = entries
            .filter((e) => !e.isDir && e.name.endsWith(".md"))
            .map((e) => `${ctx.label}::${e.path.slice(ctx.path.length + 1)}`)
            .join("\n");
          parts.push(
            `Files in ${ctx.label}:\n${fileList || "(no markdown files)"}`,
          );
        } catch {
          // Skip vaults that fail to list
        }
      }
      refs[i] = {
        type: "@all-vaults",
        label: "All Vaults",
        content: parts.join("\n\n") || "(no vault files found)",
      };
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
