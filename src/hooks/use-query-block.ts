// §5.13 useQueryBlock — loads the data a query block asks for and executes it.
//
// §310 소스가 둘이 되면서 결과 타입도 둘이다. 배열 하나에 둘을 담고 호출부가 추측하게
// 두지 않는다 — 판별 가능한 형태로 돌려주고, 렌더는 그 태그로 갈린다.
import { useCallback, useState } from "react";

import type { FileEntry, TaskEntry } from "../ipc/types";

import { getVaultTasks, listDir, readFile } from "../ipc/invoke";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { executeQuery, type VaultFile } from "../utils/query-executor";
import { parseQueryDSL } from "../utils/query-parser";
import { executeTaskQuery } from "../utils/tasks/task-query";

export type QueryResults =
  | { files: VaultFile[]; source: "files" }
  | { source: "tasks"; tasks: TaskEntry[] };

const EMPTY: QueryResults = { files: [], source: "files" };

/** 결과가 몇 건인가 — 헤더의 개수 표시가 소스를 몰라도 되게 한다. */
export function resultCount(results: QueryResults): number {
  return results.source === "files"
    ? results.files.length
    : results.tasks.length;
}

export function useQueryBlock() {
  const vaultPath = useFileStore((s) => s.rootPath);
  const tasksEnabled = useSettingsStore((s) => s.tasksEnabled);
  const tasksExclude = useSettingsStore((s) => s.tasksExcludePaths);
  const [results, setResults] = useState<QueryResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const execute = useCallback(
    async (queryDsl: string) => {
      if (!vaultPath) {
        // 센티널이다 — 문구는 뷰가 번역한다(`ERROR_KEYS`).
        setError("no-vault");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const query = parseQueryDSL(queryDsl);

        // §310 태스크 소스는 **문서가 사는 vault**를 본다 — 아젠다의 스캔 범위가
        // 아니다. 사이드바 드롭다운이 문서의 내용을 바꾸면 같은 노트를 두 사람이
        // 열었을 때 다른 것을 보게 되고, 읽는 사람은 그 드롭다운을 보지도 못한다.
        // `source: files`가 이미 이 vault를 훑는다는 점에서도 한 블록 안의 두 소스가
        // 같은 범위를 보는 쪽이 맞다.
        if (query.source === "tasks") {
          if (!tasksEnabled) {
            setError("tasks-disabled");
            setResults({ source: "tasks", tasks: [] });
            return;
          }
          const all = await getVaultTasks(vaultPath, tasksExclude);
          setResults({
            source: "tasks",
            tasks: executeTaskQuery(all, query, new Date()),
          });
          return;
        }

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

        setResults({ files: executeQuery(vaultFiles, query), source: "files" });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [tasksEnabled, tasksExclude, vaultPath],
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
