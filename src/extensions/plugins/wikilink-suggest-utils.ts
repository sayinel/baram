import type { HeadingEntry } from "../../utils/file-search";

import { readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { titleForId } from "../../stores/zettelkasten/zettel-index";
// §31 Wikilink autocomplete — utility functions
import { extractHeadings, fuzzyScore } from "../../utils/file-search";
import {
  extractLeadingId,
  parseNoteTitle,
} from "../../utils/zettelkasten/parse-note-title";

export interface WikilinkSuggestionItem {
  /**
   * §278 마크다운이 **아닌** 파일의 타입 배지 — "PDF", "PNG". 마크다운이면 없다.
   *
   * 왜 필요한가: PDF와 그 하이라이트 동반 노트는 이름이 같다(companionPathFor가
   * `papers/x.pdf` → `highlights/papers/x.md`로 만든다). 메뉴가 그리는 문자열은
   * `attention-is-all-you-need` / `attention-is-all-you-need.pdf`라 구분 정보가
   * **맨 끝**에 있는데, `.wikilink-item-label`의 말줄임이 끝에서 자르므로 이름이
   * 길면 정확히 그 부분만 사라진다.
   *
   * 배지는 별도 요소라 줄어들지 않는다(flex-shrink:0). 호버 툴팁이 아니라 배지인
   * 이유는 이 메뉴를 주로 화살표 키로 훑기 때문이다 — 툴팁은 마우스를 올려야
   * 보이고, 애초에 "지금 모호하다"를 이미 의심해야 손이 간다.
   */
  ext?: string;
  /** §87 Parent folder path relative to vault root (for grouped display) */
  folder?: string;
  heading?: string;
  headingLevel?: number;
  id: string;
  kind?: "create" | "file" | "folder-header" | "heading" | "hint";
  label: string;
  path: string;
  /**
   * §95 Zettelkasten: fuzzy-search key used instead of `target`, when set.
   * Zettel-note items (id-prefixed filenames) set this to the note title, so
   * `[[` autocomplete searches by title even though `target` is the id.
   */
  searchText?: string;
  target: string;
  /** §87 Cross-vault: vault alias prefix for the inserted wikilink */
  vaultAlias?: string;
}

/**
 * §95 Zettelkasten: build a suggestion item for one file. If the filename has a
 * leading id (12-14 digit prefix), the item's `target` is the id — so the stored
 * wikilink is `[[id]]`, rendered as the title by WikilinkView — and its
 * `searchText` is the note title (from the zettel index, falling back to
 * parsing the filename), so fuzzy search matches by title. Regular
 * (non-zettel) files are unchanged: `target` is the filename, no `searchText`.
 */
export function buildFileSuggestionItem(
  file: { name: string; path: string },
  id: string,
): WikilinkSuggestionItem {
  // §278 두 분기 모두 배지를 받아야 한다 — id 접두사가 붙은 PDF도 있을 수 있고,
  // 그쪽만 빠뜨리면 하필 이름이 긴 그 항목이 구분되지 않는다.
  const ext = badgeExtension(file.name);
  const zettelId = extractLeadingId(file.name);
  if (zettelId) {
    const title = titleForId(zettelId) ?? parseNoteTitle(file.name, "");
    return {
      id,
      ext,
      target: zettelId,
      label: title,
      path: file.path,
      searchText: title,
    };
  }
  return {
    id,
    ext,
    target: fileNameWithoutExtension(file.name),
    label: file.name,
    path: file.path,
  };
}

/** Remove .md or .markdown extension from a filename */
export function fileNameWithoutExtension(name: string): string {
  if (name.endsWith(".markdown")) {
    return name.slice(0, -9);
  }
  if (name.endsWith(".md")) {
    return name.slice(0, -3);
  }
  return name;
}

/** Filter and rank files by fuzzy query. Returns sorted results. */
export function filterFiles(
  files: WikilinkSuggestionItem[],
  query: string,
  limit: number = 20,
): WikilinkSuggestionItem[] {
  if (!query) {
    return files.slice(0, limit);
  }

  const scored = files
    .map((file) => ({
      file,
      score: fuzzyScore(query, file.searchText ?? file.target),
    }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map(({ file }) => file);
}

/**
 * Load headings from a file. Uses in-memory cache if available, falls back to readFile IPC.
 */
export async function loadFileHeadings(
  filePath: string,
): Promise<HeadingEntry[]> {
  // Check if file content is already cached in openFiles
  const cached = useFileStore.getState().openFiles.get(filePath);
  if (cached !== undefined) {
    return extractHeadings(cached);
  }

  try {
    const content = await readFile(filePath);
    return extractHeadings(content);
  } catch {
    return [];
  }
}

/** Longest common prefix of strings (case-insensitive compare, first item's casing preserved). */
export function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  if (strings.length === 1) return strings[0];

  const first = strings[0];
  const lowered = strings.map((s) => s.toLowerCase());
  let len = first.length;
  for (let i = 1; i < lowered.length; i++) {
    len = Math.min(len, lowered[i].length);
    for (let j = 0; j < len; j++) {
      if (lowered[0][j] !== lowered[i][j]) {
        len = j;
        break;
      }
    }
    if (len === 0) return "";
  }
  return first.slice(0, len);
}

/**
 * Bugfix: true when a Suggestion match's text already contains a closing `]]`
 * — i.e. the matched range spans a complete (e.g. pasted) wikilink like
 * `[[blanky]]` rather than an in-progress query like `[[blan`. The Suggestion
 * plugin (`char: "[["`, `allowSpaces: true`) has no stopping point at `]]`, so
 * pasting a complete wikilink and landing the cursor after it makes the query
 * capture the trailing `]]` (e.g. `Create "blanky]]"`). Used by the `allow`
 * callback to block the popup in that case.
 */
export function shouldBlockCompletedWikilink(matchText: string): boolean {
  return matchText.includes("]]");
}

/**
 * §278 마크다운이 아닌 파일의 타입 배지 문자열. 마크다운이거나 확장자가 없으면
 * undefined — 목록의 대다수가 노트이므로 거기에 배지를 달면 잡음만 는다.
 * **배지가 없는 줄이 곧 노트**라는 것이 읽는 규칙이다.
 */
function badgeExtension(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf(".");
  // 0번째 점은 확장자가 아니라 숨김 파일 표시다(".gitignore").
  if (dot <= 0) return undefined;
  const ext = fileName.slice(dot + 1).toLowerCase();
  if (ext === "md" || ext === "markdown") return undefined;
  return ext.toUpperCase();
}
