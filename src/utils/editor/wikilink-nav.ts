import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
// §28 Wikilink navigation — resolve target to file path
// §61 Namespace — relative path resolution (./  ../)
// §87 Cross-vault link resolution
import { isActiveContextJournal, useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { flattenFileTree } from "../file-search";
import { isDateString, resolveJournalDir } from "../journal/journal";

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
 * §87 Cross-vault resolution: when vaultAlias is set, resolve in that context.
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
  vaultAlias?: null | string,
): null | { name: string; path: string } {
  // §87 Cross-vault: resolve in the alias context
  if (vaultAlias) {
    return resolveCrossVaultTarget(vaultAlias, target);
  }

  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return null;

  // §85 M2b: Derive journal scope from context store
  const isJournalScoped = isActiveContextJournal();

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

/**
 * §87 Resolve a cross-vault wikilink target synchronously.
 * Looks up the alias in the context store and tries to find the file
 * in that context's file tree (only works if the context is active).
 */
function resolveCrossVaultTarget(
  alias: string,
  target: string,
): null | { name: string; path: string } {
  const contexts = useContextStore.getState().contexts;
  const ctx = contexts.find((c) => c.alias === alias);
  if (!ctx) return null; // Vault not registered — dangling

  const { rootPath, fileTree } = useFileStore.getState();

  // Only resolve synchronously if the alias context is the active context
  if (rootPath === ctx.path && fileTree.length > 0) {
    const flat = flattenFileTree(fileTree, rootPath);
    const targetLower = target.toLowerCase();

    // Try exact stem match
    for (const f of flat) {
      if (!f.name.endsWith(".md") && !f.name.endsWith(".markdown")) continue;
      const stem = f.name.endsWith(".markdown")
        ? f.name.slice(0, -9)
        : f.name.slice(0, -3);
      if (stem.toLowerCase() === targetLower) {
        return { path: f.path, name: f.name };
      }
    }

    // Try path match (e.g., "skills/analyzer")
    for (const f of flat) {
      const rel = f.path.slice(rootPath.length + 1);
      const relNoExt = rel.endsWith(".md")
        ? rel.slice(0, -3)
        : rel.endsWith(".markdown")
          ? rel.slice(0, -9)
          : rel;
      if (relNoExt.toLowerCase() === targetLower) {
        return { path: f.path, name: f.name };
      }
    }
  }

  return null; // Not resolvable synchronously — vault not active or file not found
}
