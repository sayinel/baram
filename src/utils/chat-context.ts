// §44 AI Chat @reference resolver
import { useEditorStore } from "../stores/editor-store";
import { useFileStore } from "../stores/file-store";

export type ReferenceType = "@selection" | "@current" | "@clipboard" | "@file";

export interface ResolvedReference {
  type: ReferenceType;
  label: string;
  content: string;
}

export function resolveReference(ref: string): ResolvedReference | null {
  if (ref === "@selection") {
    // Get current editor selection — not available without editor ref, return placeholder
    return {
      type: "@selection",
      label: "Selection",
      content: "[editor selection]",
    };
  }

  if (ref === "@current") {
    const { activeTabId, tabs } = useEditorStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    const content = useFileStore.getState().openFiles.get(tab.filePath || tab.id);
    return {
      type: "@current",
      label: tab.title,
      content: content ?? "",
    };
  }

  if (ref === "@clipboard") {
    return {
      type: "@clipboard",
      label: "Clipboard",
      content: "[clipboard content]",
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

  return null;
}

export function parseReferences(text: string): string[] {
  const refs: string[] = [];
  const regex = /@(selection|current|clipboard|file:[^\s]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    refs.push(`@${match[1]}`);
  }
  return refs;
}

export function buildContextPrompt(userMessage: string, refs: ResolvedReference[]): string {
  if (refs.length === 0) return userMessage;

  const contextParts = refs.map(
    (r) => `--- ${r.label} ---\n${r.content}`,
  );

  return `Context:\n${contextParts.join("\n\n")}\n\n---\n\nUser message: ${userMessage}`;
}
