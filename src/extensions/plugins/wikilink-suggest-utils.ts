import type { HeadingEntry } from "../../utils/file-search";

import { readFile } from "../../ipc/invoke";
import { useFileStore } from "../../stores/file/file";
import { titleForId } from "../../stores/zettelkasten/zettel-index";
// §31 Wikilink autocomplete — utility functions
import { extractHeadings, fuzzyScore } from "../../utils/file-search";
import {
  isBinaryViewerFile,
  isHtmlFile,
  isMarkdownEmbeddableAsset,
  isMarkdownFile,
  isPdfFile,
  isTextFile,
} from "../../utils/file-type";
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
  /**
   * The string the menu DRAWS. Every other row kind (create/hint/folder-header)
   * already renders this; file rows used to render `target` instead, which is
   * why §95 zettel notes showed their id — the id is what gets INSERTED, and the
   * two are not the same string for them. Keep the split: `label` is read by the
   * eye, `target` is written into the document.
   */
  label: string;
  path: string;
  /**
   * §95 Zettelkasten: the text the user's QUERY is matched against, when it is
   * not `target`. Zettel-note items (id-prefixed filenames) set this to the note
   * title, so `[[` autocomplete searches — and Tab-completes — by title even
   * though `target` is the id. Read it through `searchKey`, never directly:
   * three call sites have to agree on the fallback.
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
  // ‼️ §95 제텔 분기는 **마크다운에만** 건다. `refreshZettelIndex`는
  // `/\.(md|markdown)$/`로 마크다운만 색인하고 `[[id]]` 해석은 그 인덱스만 보므로,
  // id 접두가 붙은 PDF에 이 분기를 걸면 `[[202607051530]]`을 삽입해 놓고 아무도
  // 찾지 못하는 **영구 dangling** 링크가 된다. 파일명을 target으로 두면 일반
  // 위키링크 해석 경로가 실제 파일을 찾는다(§278이 비마크다운을 목록에 올린 이유).
  const zettelId = isMarkdownFile(file.name)
    ? extractLeadingId(file.name)
    : null;
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
  const stem = fileNameWithoutExtension(file.name);
  return {
    id,
    ext,
    target: stem,
    label: stem,
    path: file.path,
  };
}

/**
 * §95 Strings a typed `query` can be Tab-completed to, in menu order.
 *
 * ‼️ Candidates come from `label` — **the row the user is looking at** — not from
 * `target`. For a zettel note those differ: the user types the title, `target` is
 * the id, and an id never starts with a title, so a target-based pool is always
 * empty and Tab degrades into a silent no-op (silent because the handler still
 * reports the key as handled, which is how that went unnoticed).
 *
 * ‼️ `label` rather than `searchKey` because §61 relative mode prefixes the query
 * itself (`./원자`): there the label carries `./` and the search key does not, so a
 * searchKey pool drops exactly the zettel rows — leaving Tab to "complete" two
 * visible rows down to the one that survived. Completing toward what is drawn
 * keeps the two in step by construction.
 *
 * Rows that are not targets are excluded outright. `create` was always excluded;
 * `hint` and `folder-header` used to fall out only because their `target` is `""`
 * — their labels are sentences ("Cross-vault: type alias::…") that a prefix query
 * can genuinely match, so the exclusion has to be stated, not inherited.
 */
export function completionCandidates(
  items: WikilinkSuggestionItem[],
  query: string,
): string[] {
  const queryLower = query.toLowerCase();
  return items
    .filter(
      (i) =>
        i.kind !== "create" && i.kind !== "hint" && i.kind !== "folder-header",
    )
    .map((i) =>
      i.kind === "heading" ? `${searchKey(i)}#${i.heading}` : i.label,
    )
    .filter((t) => t.toLowerCase().startsWith(queryLower));
}

/**
 * §87 One row for a file in another vault. `label` is the stem for the same
 * reason it is everywhere else — it is what the menu draws — and `target` is the
 * stem because that is what `alias::target` resolution expects.
 */
export function crossVaultItem(
  file: { name: string; path: string },
  id: string,
  alias: string,
  folder?: string,
): WikilinkSuggestionItem {
  const stem = fileNameWithoutExtension(file.name);
  return {
    id,
    target: stem,
    label: stem,
    path: file.path,
    vaultAlias: alias,
    ...(folder === undefined ? {} : { folder }),
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
      score: fuzzyScore(query, searchKey(file)),
    }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score);

  return scored.slice(0, limit).map(({ file }) => file);
}

/**
 * §31 One row per heading in `bestFile`, for `[[file#heading]]` completion.
 *
 * ‼️ `searchText` is carried over from the file row. The heading row's `target`
 * is the file's — an id for a zettel note — while the query the user is typing
 * is `제목#heading`, so without the file's search key the Tab candidate would be
 * `202607051530#Background` and could never match what was typed.
 */
export function headingItems(
  bestFile: WikilinkSuggestionItem,
  headings: HeadingEntry[],
): WikilinkSuggestionItem[] {
  return headings.map((h, idx) => ({
    id: `heading-${idx}`,
    target: bestFile.target,
    label: h.text,
    path: bestFile.path,
    kind: "heading" as const,
    heading: h.text,
    headingLevel: h.level,
    searchText: bestFile.searchText,
  }));
}

/**
 * §278 자동완성에 올릴 파일.
 *
 * 규칙은 "**문서 탭에서 텍스트로 볼 수 있는 것**"이다. 해석기
 * (`wikilink-nav.ts`의 `resolveByExactFileName`)는 확장자 목록을 **의도적으로 두지
 * 않아** `[[data.csv]]`를 손으로 치면 이미 열린다 — 목록이 그보다 좁으면 기능은
 * 있는데 발견 경로가 없는 상태가 된다.
 *
 * 판정은 file-type.ts의 기존 술어로만 한다. 여기에 확장자를 열거하면 "무엇이
 * 열리는가"의 정의가 둘로 갈라져 한쪽만 갱신되는 날이 온다.
 *
 * ‼️ 제외 셋은 각각 이유가 다르다:
 * - **이미지·SVG**: 마크다운이 `![](...)`로 넣는 자산이라 위키링크 대상이 아니다.
 *   PDF·HTML은 그 문법으로 넣을 수 없어 남는다.
 * - **`.json`**: 제품 판단. vault에서 읽는 문서가 아니라 기계가 읽는 데이터로
 *   존재한다(매니페스트·설정·인덱스). 열린다는 것이 링크 대상이라는 뜻은 아니다.
 * - **숨김 경로**: `.baram/pdf-highlights/*.json`·`.baram/snapshots/`가 여기 있다.
 *   `flattenFileTree`의 EXCLUDED_DIRS는 `.DS_Store`·`.git`·`.hg`·`.svn`·
 *   `node_modules` 다섯뿐이라 `.baram`을 막지 못한다.
 *
 * ‼️ 텍스트가 아닌 것을 올리면 안 되는 이유는 목록 잡음이 아니다: 탭 표면이
 * 마지막에 `return "code"`로 떨어져 CodeMirror가 UTF-8로 읽고, 자동 저장은
 * `isBinaryViewerFile`만 건너뛰므로 dirty가 되면 **원본을 덮어쓴다**.
 */
export function isLinkableFile(file: {
  name: string;
  relativePath: string;
}): boolean {
  if (isHiddenPath(file.relativePath)) return false;
  if (isMarkdownEmbeddableAsset(file.name)) return false;
  if (isJsonFile(file.name)) return false;
  return (
    isMarkdownFile(file.name) ||
    isPdfFile(file.name) ||
    isHtmlFile(file.name) ||
    isTextFile(file.name)
  );
}

/**
 * §278.2 "Create" writes a markdown note — `${target}.md` holding `# ${target}`.
 *
 * Now that `[[Paper.pdf]]` is a target you can type, a miss on one used to offer to
 * create `Paper.pdf.md` containing `# Paper.pdf`. Nothing about that is what the user
 * asked for, and the app cannot create a PDF from a menu either — so the option is
 * withdrawn rather than made to produce something plausible-looking.
 *
 * ‼️ This is a SUPPRESSION, which is why it may key off the file type at all. Getting it
 * wrong costs a missing "create" entry for a name the user can still create from the file
 * tree; the resolver, by contrast, must stay permissive and enumerates nothing (see
 * wikilink-nav.ts). Different jobs, different rules.
 */
export function isCreatableTarget(target: string): boolean {
  return !isBinaryViewerFile(target) && !isHtmlFile(target);
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
 * §61 Namespace mode: the items for one resolved directory, with the relative
 * prefix applied to the strings that must live in the query's coordinate space.
 *
 * The query in this mode is itself prefixed (`./원자`), so both the DRAWN string
 * (`label`, which `completionCandidates` builds the Tab pool from) and the
 * INSERTED string (`target`) carry the prefix. `searchText` deliberately does
 * not: `filterFiles` is called here with the prefix already stripped off the
 * query (`fileQuery`), so prefixing the search key would make every zettel row
 * unmatchable.
 *
 * ‼️ That asymmetry is the whole content of this function, and getting it wrong
 * is silent in both directions — a prefixed search key drops rows from the menu,
 * an unprefixed label drops them from the Tab pool while they stay visible.
 */
export function namespaceItems(
  files: WikilinkSuggestionItem[],
  targetDir: string,
  dirPrefix: string,
): WikilinkSuggestionItem[] {
  return files
    .filter((f) => f.path.substring(0, f.path.lastIndexOf("/")) === targetDir)
    .map((f) => ({
      ...f,
      label: `${dirPrefix}${f.label}`,
      target: `${dirPrefix}${f.target}`,
    }));
}

/**
 * §95 The text a typed query is matched against: the note title for zettel items
 * (whose `target` is the id), the target itself for everything else. Single
 * source for fuzzy search, exact-match detection, and Tab completion — three
 * places that must agree on "what the user is typing".
 */
export function searchKey(item: WikilinkSuggestionItem): string {
  return item.searchText ?? item.target;
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

/** §278.2 `foo` → `foo.md`, but `foo.md` stays `foo.md`. */
export function withMarkdownExtension(target: string): string {
  const lower = target.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown")
    ? target
    : `${target}.md`;
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

/** 숨김 파일 또는 숨김 디렉터리 안의 파일 — 어느 세그먼트든 `.`로 시작하면 참. */
function isHiddenPath(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith("."));
}

/** `.json` 판정. 확장자 하나뿐이라 file-type.ts에 술어를 세우지 않는다. */
function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".json");
}
