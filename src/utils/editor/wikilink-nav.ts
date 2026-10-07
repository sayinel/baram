import type { ContextInfo, VaultType } from "../../ipc/types";

import { unescapeBlockRefTarget } from "../../pipeline/block-id";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
// §28 Wikilink navigation — resolve target to file path
// §61 Namespace — relative path resolution (./  ../)
// §87 Cross-vault link resolution
import { isActiveContextJournal, useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { flattenFileTree } from "../file-search";
import { isDateString, resolveJournalDir } from "../journal/journal";
import { foldName } from "../name-fold";
import { normalizePath } from "../path-utils";

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
  const normalized = normalizePath(`${sourceDir}/${target}`);
  // normalizePath reads absoluteness off the joined string, which starts with
  // "/" even when sourcePath had no directory part at all ("note.md" → "").
  // Absoluteness is a property of the source, not of the join.
  const candidateBase = isAbsolute ? normalized : normalized.replace(/^\//, "");
  // Try with .md extension
  const candidate = candidateBase.endsWith(".md")
    ? candidateBase
    : `${candidateBase}.md`;
  return candidate;
}

/**
 * Resolve a wikilink target (e.g. "architecture") to a file path.
 * Exact match on the filename stem (without .md extension) under `foldName`:
 * case and Unicode normalization ignored (§390).
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
  rawTarget: string,
  vaultAlias?: null | string,
): null | { name: string; path: string } {
  // §275.4 CRITICAL-2 highlight-ref targets carry escapeBlockRefTarget's
  // `)`/`#`/`|`/`%` escaping (see pipeline/block-id.ts) — undo it before any
  // resolution below, all of which compare against real on-disk paths.
  // Ordinary wikilink/block-ref targets never legitimately contain the
  // escaped sequences, so this is a no-op for them.
  const target = unescapeBlockRefTarget(rawTarget);

  // §87 Cross-vault: resolve in the alias context
  if (vaultAlias) {
    return resolveCrossVaultTarget(vaultAlias, target);
  }

  // §89 FileContext: resolve wikilinks within the same folder only
  const activeCtx = useContextStore.getState().activeContext();
  if (activeCtx?.contextType === "file") {
    return resolveInSameFolder(target, activeCtx.path);
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
        // §390 Case and Unicode normalization ignored (spec 0069 §3.3): the
        // candidate joins the open note's folder as stored with the name as
        // typed.
        const wanted = foldName(candidate);
        const match = flat.find((f) => foldName(f.path) === wanted);
        if (match) return { path: match.path, name: match.name };
      }
    }
    return null; // Relative paths don't fall back to global search
  }

  // §390 Names compare under foldName — case and Unicode normalization
  // ignored (spec 0069 §3.3): a note the disk stores decomposed (NFD)
  // answers to the composed name typed.
  const targetKey = foldName(target);

  // §56l Journal-aware: try notes/ first when journal-scoped
  if (isJournalScoped) {
    const { journalDirectory, journalUseHierarchy } =
      useSettingsStore.getState();
    const journalDir = resolveJournalDir(rootPath, journalDirectory);
    if (journalDir) {
      // §390 The settings spell the journal's paths and the disk spells the
      // tree's, so the notes/ loop and the date lookup below compare them
      // composed (NFC), case as written — paths, not names (spec 0069 D4).
      // `rel` is cut from the composed path at a length measured on the
      // composed folder, never from `f.path`, a spelling it was not measured on.
      const notesDir = `${journalDir}/notes`.normalize("NFC");

      // Try notes/name.md (supports folder/name too)
      for (const f of flat) {
        const path = f.path.normalize("NFC");
        if (!path.startsWith(notesDir)) continue;
        const noteStem = f.name.endsWith(".md") ? f.name.slice(0, -3) : f.name;
        if (foldName(noteStem) === targetKey) {
          return { path: f.path, name: f.name };
        }
        // Also match folder/name patterns
        const rel = path.slice(notesDir.length + 1).replace(/\.md$/, "");
        if (foldName(rel) === targetKey) {
          return { path: f.path, name: f.name };
        }
      }

      // Try date string → daily path
      if (isDateString(target)) {
        const [y, m] = target.split("-");
        const dailyPath = (
          journalUseHierarchy
            ? `${journalDir}/daily/${y}/${m}/${target}.md`
            : `${journalDir}/${target}.md`
        ).normalize("NFC");
        const match = flat.find((f) => f.path.normalize("NFC") === dailyPath);
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

    if (foldName(stem) === targetKey) {
      return { path: f.path, name: f.name };
    }

    // §275.4 Path-qualified target, e.g. [[highlights/papers/attention]] —
    // stem-only matching above picks whichever file anywhere in the tree
    // happens to share a bare name, which is exactly the ambiguity a
    // path-qualified target exists to avoid. Only attempted when the target
    // actually carries a path segment, so plain [[name]] wikilinks keep the
    // stem-only behavior above untouched.
    if (target.includes("/")) {
      const relStem = f.relativePath.endsWith(".markdown")
        ? f.relativePath.slice(0, -9)
        : f.relativePath.replace(/\.md$/i, "");
      if (foldName(relStem) === targetKey) {
        return { path: f.path, name: f.name };
      }
    }
  }

  return resolveByExactFileName(flat, targetKey, target.includes("/"));
}

/**
 * §278 확장자를 적은 타깃을 실제 파일에 맞춘다 — `[[Paper.pdf]]`, `[[그림.png]]`.
 *
 * PDF를 마크다운에서 가리킬 방법이 없었다. 위의 표준 해석이 `.md`/`.markdown`만
 * 후보로 보기 때문인데, 하필 하이라이트 동반 노트의 경로 규칙이
 * `Paper.pdf` → `highlights/Paper.md`라 stem이 정확히 겹친다. 그래서 `[[Paper]]`는
 * PDF가 아니라 동반 노트로 갔다 — 우리 명명 규칙이 만든 충돌이다.
 *
 * ‼️ **md 해석이 실패한 뒤에만** 불린다. 순서가 안전장치다: 지금 해석되는 링크는
 * 전부 위에서 결정되므로 이 함수가 기존 링크의 의미를 바꿀 수 없다. bare `[[Paper]]`도
 * 계속 동반 노트를 가리킨다 — 그것을 뺏으면 이미 그 링크를 쓰던 문서가 조용히 끊긴다
 * (발견 함수를 더 엄격하게 만드는 방향은 위험하다). 대신 자동완성이 둘 다 보여준다.
 *
 * ‼️ 확장자 목록도, "확장자가 있는가" 판별도 두지 않는다. 판별을 패턴으로 하면
 * `[[v1.2 회의록]]`처럼 이름에 점이 든 노트가 확장자로 오인된다. 그냥 트리의 실제
 * 파일명(경로를 적은 타깃이면 루트 기준 상대경로도)과 같은지만 본다 — 대소문자와
 * 유니코드 정규화는 무시한다(`foldName`, §390). 그래서 §69의 새 뷰어
 * 타입(이미지·SVG·HTML)이 자동으로 따라오고, 열거를 갱신하지 않아 조용히 빠지는
 * 일이 없다.
 *
 * 열기는 이미 준비돼 있다: 네비게이션은 확장자를 보고 뷰어로 보낸다
 * (use-navigation.ts의 하이라이트 참조 점프가 같은 경로로 PDF를 연다).
 */
function resolveByExactFileName(
  flat: { name: string; path: string; relativePath: string }[],
  targetKey: string,
  targetHasPath: boolean,
): null | { name: string; path: string } {
  for (const f of flat) {
    if (foldName(f.name) === targetKey) {
      return { path: f.path, name: f.name };
    }
    // 경로를 적은 타깃만 상대경로와 대조한다 — bare 타깃까지 여기서 맞추면
    // 위 stem 규칙(경로 세그먼트가 있을 때만 경로 대조)과 어긋난다.
    if (targetHasPath && foldName(f.relativePath) === targetKey) {
      return { path: f.path, name: f.name };
    }
  }
  return null;
}

/**
 * §317 Stable aliases for the special space contexts.
 *
 * A space context's `alias` is derived from its DIRECTORY NAME —
 * `ensureSpaceContext` passes no alias, so `addContext` falls back to
 * `labelFromPath(path)` (`context.ts:334`). A journal kept in `일기/` is
 * therefore reachable as `[[일기::2026-08-30]]` but NOT as `[[Journal::…]]`,
 * which is the syntax §317 makes the official route to the journal.
 *
 * These names are matched IN ADDITION to the folder-derived alias — the alias
 * field is never overwritten, so `[[일기::…]]` keeps working. `general` has no
 * canonical name: an empty string here would make every plain vault answer to
 * `[[::…]]`.
 */
const SPACE_ALIASES: Partial<Record<VaultType, string>> = {
  journal: "Journal",
  zettelkasten: "Zettel",
};

/**
 * §317 Find the context an `alias::` prefix refers to.
 *
 * ‼️ This lookup lives here as ONE ruler: every place that reads an `alias::`
 * prefix must agree on what it names. When the synchronous path below and
 * `use-navigation.ts`'s §87 async fallback were two copies, widening one
 * would have made `[[Journal::x]]` resolve on the sync path only — i.e. only
 * for files in the currently open vault.
 */
export function findAliasContext(alias: string): ContextInfo | null {
  // §390 An alias defaults to its folder's name, which the disk may store
  // decomposed (NFD) while the link was typed composed: aliases fold, as
  // names do.
  const key = foldName(alias);
  const isKey = (name: string | undefined): boolean =>
    name !== undefined && foldName(name) === key;
  const contexts = useContextStore.getState().contexts;

  // ‼️ Two passes, not one predicate. An explicit alias always outranks a
  // canonical space name: a vault the user actually named "Journal" is what
  // `[[Journal::…]]` should mean, whatever order the contexts happen to sit in.
  // One `find` over an OR would decide that by array position instead.
  const explicit = contexts.find((c) => isKey(c.alias));
  if (explicit) return explicit;

  return (
    contexts.find(
      (c) => c.vaultType !== undefined && isKey(SPACE_ALIASES[c.vaultType]),
    ) ?? null
  );
}

/**
 * §87 The first markdown note in `files` whose stem is `target` under
 * `foldName` (§390). One lookup for the two cross-vault paths — the
 * synchronous one below and `use-navigation.ts`'s async fallback — so the two
 * fold alike.
 */
export function findNoteByStem<T extends { name: string }>(
  files: T[],
  target: string,
): null | T {
  const wanted = foldName(target);
  for (const f of files) {
    if (!f.name.endsWith(".md") && !f.name.endsWith(".markdown")) continue;
    const stem = f.name.endsWith(".markdown")
      ? f.name.slice(0, -9)
      : f.name.slice(0, -3);
    if (foldName(stem) === wanted) return f;
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
  const ctx = findAliasContext(alias);
  if (!ctx) return null; // Vault not registered — dangling

  const { rootPath, fileTree } = useFileStore.getState();

  // Only resolve synchronously if the alias context is the active context
  if (rootPath === ctx.path && fileTree.length > 0) {
    const flat = flattenFileTree(fileTree, rootPath);

    // Try exact stem match
    const byStem = findNoteByStem(flat, target);
    if (byStem) return { path: byStem.path, name: byStem.name };

    // Try path match (e.g., "skills/analyzer")
    const targetKey = foldName(target);
    for (const f of flat) {
      const rel = f.path.slice(rootPath.length + 1);
      const relNoExt = rel.endsWith(".md")
        ? rel.slice(0, -3)
        : rel.endsWith(".markdown")
          ? rel.slice(0, -9)
          : rel;
      if (foldName(relNoExt) === targetKey) {
        return { path: f.path, name: f.name };
      }
    }
  }

  return null; // Not resolvable synchronously — vault not active or file not found
}

/**
 * §89 Resolve a wikilink within the same folder as the standalone file.
 * FileContext has no file tree, so we check the folder of the source file
 * using the global file tree (if the folder happens to be loaded) or
 * construct the candidate path directly.
 */
function resolveInSameFolder(
  target: string,
  sourceFilePath: string,
): null | { name: string; path: string } {
  const dir = sourceFilePath.substring(0, sourceFilePath.lastIndexOf("/"));
  const key = foldName(target);
  const candidateName = key.endsWith(".md") ? target : `${target}.md`;
  const candidatePath = `${dir}/${candidateName}`;

  // Try to find in file tree if available (some other context may cover this folder)
  const { fileTree, rootPath } = useFileStore.getState();
  if (rootPath && fileTree.length > 0) {
    const flat = flattenFileTree(fileTree, rootPath);
    for (const f of flat) {
      if (!f.path.startsWith(dir + "/")) continue;
      // Only same folder, not subfolders
      const relFromDir = f.path.slice(dir.length + 1);
      if (relFromDir.includes("/")) continue;

      const stem = f.name.endsWith(".md") ? f.name.slice(0, -3) : f.name;
      if (foldName(stem) === key) {
        return { path: f.path, name: f.name };
      }
    }
  }

  // Construct candidate path — caller will check if file exists via navigation
  return {
    path: candidatePath,
    name: candidateName,
  };
}
