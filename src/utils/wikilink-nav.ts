import { useEditorStore } from "../stores/editor-store";
// §28 Wikilink navigation — resolve target to file path
// §61 Namespace — relative path resolution (./  ../)
import { useFileStore } from "../stores/file-store";
import { useSettingsStore } from "../stores/settings-store";
import { flattenFileTree } from "./file-search";
import { isDateString, resolveJournalDir } from "./journal";

/**
 * §61 Resolve a relative wikilink target (starting with ./ or ../)
 * against the current file's directory.
 */
export function resolveRelativeTarget(
  target: string,
  sourcePath: string,
): null | string {
  const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
  const isAbsolute = sourceDir.startsWith("/");
  // Build candidate: join sourceDir + target, then normalize
  const parts = `${sourceDir}/${target}`.split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") {
      if (resolved.length > 0) resolved.pop();
    } else {
      resolved.push(p);
    }
  }
  const candidateBase = (isAbsolute ? "/" : "") + resolved.join("/");
  // Try with .md extension
  const candidate = candidateBase.endsWith(".md")
    ? candidateBase
    : `${candidateBase}.md`;
  return candidate;
}

/**
 * Resolve a wikilink target (e.g. "architecture") to a file path.
 * Case-insensitive exact match on filename stem (without .md extension).
 *
 * §61 Namespace-aware resolution order:
 * 0. [[./name]] or [[../path/name]] → relative to current file's directory
 * §56l Journal-aware resolution order:
 * 1. [[name]] → notes/name.md (if journal scope active)
 * 2. [[folder/name]] → notes/folder/name.md
 * 3. [[2026-02-28]] → daily/2026/02/2026-02-28.md (date string)
 * 4. Fallback → any file in fileTree (existing behavior)
 */
export function resolveWikilinkTarget(
  target: string,
): null | { name: string; path: string } {
  const { rootPath, fileTree, isJournalScoped } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return null;

  const flat = flattenFileTree(fileTree, rootPath);

  // §61 Relative path resolution: [[./file]] or [[../path/file]]
  if (target.startsWith("./") || target.startsWith("../")) {
    const activeTabId = useEditorStore.getState().activeTabId;
    const activeTab = useEditorStore
      .getState()
      .tabs.find((t) => t.id === activeTabId);
    const sourcePath = activeTab?.filePath;
    if (sourcePath) {
      const candidate = resolveRelativeTarget(target, sourcePath);
      if (candidate) {
        const candidateLower = candidate.toLowerCase();
        const match = flat.find((f) => f.path.toLowerCase() === candidateLower);
        if (match) return { path: match.path, name: match.name };
      }
    }
    return null; // Relative paths don't fall back to global search
  }

  const targetLower = target.toLowerCase();

  // §56l Journal-aware: try notes/ first when journal-scoped
  if (isJournalScoped) {
    const { journalDirectory, journalUseHierarchy } =
      useSettingsStore.getState();
    const journalDir = resolveJournalDir(rootPath, journalDirectory);
    if (journalDir) {
      const notesDir = `${journalDir}/notes`;

      // Try notes/name.md (supports folder/name too)
      for (const f of flat) {
        if (!f.path.startsWith(notesDir)) continue;
        const stem = f.name.endsWith(".md") ? f.name.slice(0, -3) : f.name;
        if (stem.toLowerCase() === targetLower) {
          return { path: f.path, name: f.name };
        }
        // Also match folder/name patterns
        const relPath = f.path.slice(notesDir.length + 1).replace(/\.md$/, "");
        if (relPath.toLowerCase() === targetLower) {
          return { path: f.path, name: f.name };
        }
      }

      // Try date string → daily path
      if (isDateString(target)) {
        const [y, m] = target.split("-");
        const dailyPath = journalUseHierarchy
          ? `${journalDir}/daily/${y}/${m}/${target}.md`
          : `${journalDir}/${target}.md`;
        const match = flat.find((f) => f.path === dailyPath);
        if (match) return { path: match.path, name: match.name };
      }
    }
  }

  // Standard resolution: any file in tree
  for (const f of flat) {
    if (!f.name.endsWith(".md") && !f.name.endsWith(".markdown")) continue;

    const stem = f.name.endsWith(".markdown")
      ? f.name.slice(0, -9)
      : f.name.slice(0, -3);

    if (stem.toLowerCase() === targetLower) {
      return { path: f.path, name: f.name };
    }
  }

  return null;
}
