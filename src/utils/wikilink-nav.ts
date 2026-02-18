// §28 Wikilink navigation — resolve target to file path
import { useFileStore } from "../stores/file-store";
import { flattenFileTree } from "./file-search";

/**
 * Resolve a wikilink target (e.g. "architecture") to a file path.
 * Case-insensitive exact match on filename stem (without .md extension).
 * Returns null if no matching file found.
 */
export function resolveWikilinkTarget(
  target: string,
): { path: string; name: string } | null {
  const { rootPath, fileTree } = useFileStore.getState();
  if (!rootPath || fileTree.length === 0) return null;

  const flat = flattenFileTree(fileTree, rootPath);
  const targetLower = target.toLowerCase();

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
