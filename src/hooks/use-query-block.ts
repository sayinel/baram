// §5.13 useQueryBlock — loads vault files and executes queries
import { useCallback, useState } from "react";

import type { FileEntry } from "../ipc/types";

import { listDir, readFile } from "../ipc/invoke";
import { useFileStore } from "../stores/file/file";
import { executeQuery, type VaultFile } from "../utils/query-executor";
import { parseQueryDSL } from "../utils/query-parser";

export function useQueryBlock() {
  const vaultPath = useFileStore((s) => s.rootPath);
  const [results, setResults] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const execute = useCallback(
    async (queryDsl: string) => {
      if (!vaultPath) {
        setError("No vault open");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const query = parseQueryDSL(queryDsl);

        // Load all markdown files from vault
        const allFiles: FileEntry[] = await listDir(vaultPath, true);
        const mdFiles = allFiles.filter(
          (f) => !f.isDir && f.name.endsWith(".md"),
        );

        // Check if we need body content (for body contains filter)
        const needsBody = query.filters.some((f) => f.field === "body");

        // Convert FileEntry to VaultFile
        const vaultFiles: VaultFile[] = await Promise.all(
          mdFiles.map(async (f) => {
            // Only read full content if body search is needed
            let content: string | undefined;
            let frontmatter: Record<string, unknown> = {};
            let tags: string[] = [];

            try {
              const text = await readFile(f.path);
              frontmatter = parseFrontmatter(text);
              tags = extractTags(text);
              if (needsBody) content = text;
            } catch {
              // Skip files that can't be read
            }

            // Compute relative path from vault root
            const relativePath = f.path.startsWith(vaultPath)
              ? f.path.slice(vaultPath.length).replace(/^\//, "")
              : f.path;

            return {
              path: relativePath,
              name: f.name,
              tags,
              frontmatter,
              modifiedAt: f.modifiedAt,
              content,
            };
          }),
        );

        const filtered = executeQuery(vaultFiles, query);
        setResults(filtered);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [vaultPath],
  );

  return { results, loading, error, execute, vaultPath };
}

// Extract tags (#tag) from content
function extractTags(content: string): string[] {
  const matches = content.match(/#[a-zA-Z0-9_\-/\u3131-\uD79D]+/g);
  return matches ? [...new Set(matches.map((t) => t.slice(1)))] : [];
}

// Parse frontmatter from markdown content
function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---")) return {};
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return {};
  const yaml = content.slice(4, endIdx);
  const result: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    // Remove surrounding quotes
    result[key] = val.replace(/^["']|["']$/g, "");
  }
  return result;
}
