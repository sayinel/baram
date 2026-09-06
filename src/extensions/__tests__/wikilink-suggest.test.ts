import { Editor } from "@tiptap/core";
import { findSuggestionMatch } from "@tiptap/suggestion";
// §31 wikilink autocomplete — search/filter logic tests
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { hasExactMatch } from "../plugins/wikilink-suggest";
import {
  completionCandidates,
  crossVaultItem,
  fileNameWithoutExtension,
  filterFiles,
  headingItems,
  isLinkableFile,
  longestCommonPrefix,
  namespaceItems,
  shouldBlockCompletedWikilink,
  type WikilinkSuggestionItem,
} from "../plugins/wikilink-suggest-utils";

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "<p></p>",
  });
}

/**
 * ‼️ `label`은 `buildFileSuggestionItem`이 만드는 형태와 같아야 한다 — 확장자 없는
 * stem. 메뉴가 그리는 문자열이자 Tab 완성 후보라, 픽스처가 프로덕션과 어긋나면
 * label을 보는 단정이 조용히 공허해진다.
 */
const testFiles: WikilinkSuggestionItem[] = [
  {
    id: "1",
    target: "architecture",
    label: "architecture",
    path: "/vault/architecture.md",
  },
  {
    id: "2",
    target: "architecture-decisions",
    label: "architecture-decisions",
    path: "/vault/architecture-decisions.md",
  },
  {
    id: "3",
    target: "roadmap",
    label: "roadmap",
    path: "/vault/roadmap.md",
  },
  {
    id: "4",
    target: "meeting-notes",
    label: "meeting-notes",
    path: "/vault/notes/meeting-notes.md",
  },
  {
    id: "5",
    target: "api-design",
    label: "api-design",
    path: "/vault/docs/api-design.md",
  },
  {
    id: "6",
    target: "getting-started",
    label: "getting-started",
    path: "/vault/docs/getting-started.md",
  },
];

describe("filterFiles", () => {
  it("returns all files for empty query", () => {
    const result = filterFiles(testFiles, "");
    expect(result).toHaveLength(testFiles.length);
  });

  it("filters by exact prefix match", () => {
    const result = filterFiles(testFiles, "arch");
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].target).toBe("architecture");
  });

  it("fuzzy matches across word boundaries", () => {
    const result = filterFiles(testFiles, "mn");
    const targets = result.map((r) => r.target);
    expect(targets).toContain("meeting-notes");
  });

  it("ranks exact prefix higher than fuzzy", () => {
    const result = filterFiles(testFiles, "road");
    expect(result[0].target).toBe("roadmap");
  });

  it("returns empty for no match", () => {
    const result = filterFiles(testFiles, "zzzzxyz");
    expect(result).toHaveLength(0);
  });

  it("is case insensitive", () => {
    const result = filterFiles(testFiles, "API");
    const targets = result.map((r) => r.target);
    expect(targets).toContain("api-design");
  });

  it("limits results", () => {
    const result = filterFiles(testFiles, "", 3);
    expect(result).toHaveLength(3);
  });
});

describe("§95 hasExactMatch — zettel title exact-match Create suppression", () => {
  it("matches regular (non-zettel) files by target, unchanged behavior", () => {
    expect(hasExactMatch(testFiles, "roadmap")).toBe(true);
    expect(hasExactMatch(testFiles, "nonexistent")).toBe(false);
  });

  it("is case-insensitive for target matches", () => {
    expect(hasExactMatch(testFiles, "ROADMAP")).toBe(true);
  });

  it("suppresses Create for a zettel note when the query matches its title (searchText), not the id", () => {
    const zettelFiles: WikilinkSuggestionItem[] = [
      {
        id: "0",
        target: "202607051530",
        label: "원자적 노트",
        path: "/vault/notes/202607051530 원자적 노트.md",
        searchText: "원자적 노트",
      },
    ];

    expect(hasExactMatch(zettelFiles, "원자적 노트")).toBe(true);
  });

  it("does not treat the raw zettel id as an exact title match", () => {
    const zettelFiles: WikilinkSuggestionItem[] = [
      {
        id: "0",
        target: "202607051530",
        label: "원자적 노트",
        path: "/vault/notes/202607051530 원자적 노트.md",
        searchText: "원자적 노트",
      },
    ];

    // Before the fix this compared against `target` (the id) and would
    // incorrectly return false for the title query, showing a redundant
    // Create "원자적 노트" item alongside the existing note.
    expect(hasExactMatch(zettelFiles, "202607051530")).toBe(false);
  });
});

describe("fileNameWithoutExtension", () => {
  it("removes .md extension", () => {
    expect(fileNameWithoutExtension("architecture.md")).toBe("architecture");
  });

  it("removes .markdown extension", () => {
    expect(fileNameWithoutExtension("notes.markdown")).toBe("notes");
  });

  it("returns name as-is if no known extension", () => {
    expect(fileNameWithoutExtension("readme")).toBe("readme");
  });

  it("handles names with dots", () => {
    expect(fileNameWithoutExtension("v1.0-notes.md")).toBe("v1.0-notes");
  });
});

// --- §61 Namespace: filterFiles with relative-prefix items ---

describe("§61 Namespace: filterFiles with relative-prefix items", () => {
  const namespacedFiles: WikilinkSuggestionItem[] = [
    {
      id: "1",
      target: "./prompt",
      label: "prompt.md",
      path: "/vault/notes/ai/prompt.md",
    },
    {
      id: "2",
      target: "./models",
      label: "models.md",
      path: "/vault/notes/ai/models.md",
    },
    {
      id: "3",
      target: "./training",
      label: "training.md",
      path: "/vault/notes/ai/training.md",
    },
    {
      id: "4",
      target: "../meeting-notes",
      label: "meeting-notes.md",
      path: "/vault/notes/meeting-notes.md",
    },
  ];

  it("returns all relative-prefixed items for empty query", () => {
    const result = filterFiles(namespacedFiles, "");
    expect(result).toHaveLength(4);
  });

  it("filters ./ prefixed items by file query", () => {
    const result = filterFiles(namespacedFiles, "pro");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].target).toBe("./prompt");
  });

  it("filters ../ prefixed items by file query", () => {
    const result = filterFiles(namespacedFiles, "meet");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].target).toBe("../meeting-notes");
  });

  it("returns empty for no match in namespace scope", () => {
    const result = filterFiles(namespacedFiles, "zzzzxyz");
    expect(result).toHaveLength(0);
  });

  it("preserves relative prefix in results", () => {
    const result = filterFiles(namespacedFiles, "mod");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].target).toMatch(/^\.\//);
  });
});

describe("bugfix: pasted complete [[wikilink]] should not trigger autocomplete", () => {
  it("root cause: findSuggestionMatch on a pasted [[blanky]] captures the trailing ]] into the query", () => {
    const editor = createEditor();
    // Simulate a paste: insertContent inserts literal text, bypassing
    // InputRules (which only fire on real keystrokes via handleTextInput),
    // so this lands as plain text "[[blanky]]" — exactly like a clipboard paste.
    editor.commands.insertContent("[[blanky]]");
    const $position = editor.state.selection.$from;

    const match = findSuggestionMatch({
      char: "[[",
      allowSpaces: true,
      allowToIncludeChar: false,
      allowedPrefixes: [" "],
      startOfLine: false,
      $position,
    });

    expect(match).not.toBeNull();
    // KEY FINDING: query captures the trailing ]] instead of stopping at it —
    // this is exactly the "blanky]]" query from the bug report.
    expect(match!.query).toBe("blanky]]");
    expect(match!.text).toBe("[[blanky]]");

    // KEY FINDING: range spans the ENTIRE "[[blanky]]" text, so reading the
    // matched text back out of the doc reveals the closing ]] is included.
    const matchedText = editor.state.doc.textBetween(
      match!.range.from,
      match!.range.to,
      undefined,
      "￼",
    );
    expect(matchedText).toBe("[[blanky]]");
    expect(shouldBlockCompletedWikilink(matchedText)).toBe(true);

    editor.destroy();
  });

  it("in-progress [[blan (no closing ]]) still allows autocomplete", () => {
    const editor = createEditor();
    editor.commands.insertContent("[[blan");
    const $position = editor.state.selection.$from;

    const match = findSuggestionMatch({
      char: "[[",
      allowSpaces: true,
      allowToIncludeChar: false,
      allowedPrefixes: [" "],
      startOfLine: false,
      $position,
    });

    expect(match).not.toBeNull();
    expect(match!.query).toBe("blan");

    const matchedText = editor.state.doc.textBetween(
      match!.range.from,
      match!.range.to,
      undefined,
      "￼",
    );
    expect(shouldBlockCompletedWikilink(matchedText)).toBe(false);

    editor.destroy();
  });
});

describe("longestCommonPrefix", () => {
  it("returns empty string for empty array", () => {
    expect(longestCommonPrefix([])).toBe("");
  });

  it("returns the full string for single item", () => {
    expect(longestCommonPrefix(["architecture"])).toBe("architecture");
  });

  it("finds common prefix for multiple items", () => {
    expect(
      longestCommonPrefix(["architecture", "architecture-decisions"]),
    ).toBe("architecture");
  });

  it("returns empty when no common prefix", () => {
    expect(longestCommonPrefix(["api-design", "roadmap"])).toBe("");
  });

  it("is case-insensitive, preserves first item casing", () => {
    expect(
      longestCommonPrefix(["Architecture", "architecture-decisions"]),
    ).toBe("Architecture");
  });

  it("handles heading mode targets", () => {
    expect(
      longestCommonPrefix(["architecture#Overview", "architecture#Options"]),
    ).toBe("architecture#O");
  });

  it("handles all identical strings", () => {
    expect(longestCommonPrefix(["abc", "abc", "abc"])).toBe("abc");
  });
});

/**
 * §95 Tab 공통접두 완성이 무엇을 향해 완성하는가.
 *
 * Tab은 사용자가 **타이핑한 쿼리**를 늘린다. 제텔 노트에서 타이핑하는 것은 제목이므로
 * 후보도 제목이어야 한다 — ID를 후보로 삼으면 `startsWith` 가 언제나 실패해서 Tab이
 * 조용한 no-op이 된다(눈에 보이는 오류가 없어 결함이 오래 남는 모양이다).
 */
describe("§95 completionCandidates — Tab completes toward the typed text", () => {
  const zettel: WikilinkSuggestionItem = {
    id: "0",
    target: "202607051530",
    label: "원자적 노트",
    path: "/vault/notes/202607051530 원자적 노트.md",
    searchText: "원자적 노트",
  };

  it("offers a zettel note's title, never its id", () => {
    expect(completionCandidates([zettel], "원자")).toEqual(["원자적 노트"]);
  });

  // 순수 함수 계약으로 적는다: 사용자가 ID를 타이핑하는 경로로는 이 단정에
  // 닿을 수 없다 — `filterFiles`가 제목으로 거르므로 그 항목은 `state.items`에
  // 애초에 없다. 여기서 고정하는 것은 "id는 후보 문자열이 되지 않는다" 하나다.
  it("never yields the id as a candidate string", () => {
    expect(completionCandidates([zettel], "2026")).toEqual([]);
  });

  it("offers regular files by target, unchanged behavior", () => {
    expect(completionCandidates(testFiles, "architecture")).toEqual([
      "architecture",
      "architecture-decisions",
    ]);
  });

  it("is case-insensitive on the typed prefix", () => {
    expect(completionCandidates(testFiles, "ROAD")).toEqual(["roadmap"]);
  });

  it("excludes the Create item — it is not something to complete toward", () => {
    const items: WikilinkSuggestionItem[] = [
      ...testFiles,
      {
        id: "__create__",
        target: "arch",
        label: 'Create "arch"',
        path: "",
        kind: "create",
      },
    ];

    expect(completionCandidates(items, "arch")).toEqual([
      "architecture",
      "architecture-decisions",
    ]);
  });

  /**
   * §61 상대 경로 모드는 **좌표계가 다르다** — 쿼리(`./원자`)에 접두사가 붙어 있다.
   * 후보를 접두사 없는 검색 키로 만들면 제텔 항목만 조용히 후보에서 빠지고, 메뉴에
   * 두 줄이 보이는데 Tab이 남은 한 줄로 확정해 버린다(보이는 것과 하는 것이 갈린다).
   */
  it("keeps a zettel item in the pool in ./ relative mode, where the query is prefixed", () => {
    const items: WikilinkSuggestionItem[] = [
      {
        id: "0",
        target: "./202607051530",
        label: "./원자적 노트",
        path: "/vault/notes/ai/202607051530 원자적 노트.md",
        searchText: "원자적 노트",
      },
      {
        id: "1",
        target: "./readme",
        label: "./readme",
        path: "/vault/notes/ai/readme.md",
      },
    ];

    expect(completionCandidates(items, "./")).toEqual([
      "./원자적 노트",
      "./readme",
    ]);
    expect(longestCommonPrefix(completionCandidates(items, "./"))).toBe("./");
  });

  it("never offers a hint row — its label is a sentence, not a target", () => {
    const items: WikilinkSuggestionItem[] = [
      {
        id: "__hint_crossvault__",
        target: "",
        label: "Cross-vault: type alias:: (e.g., work::)",
        path: "",
        kind: "hint",
      },
    ];

    expect(completionCandidates(items, "cross")).toEqual([]);
  });

  it("never offers a folder header", () => {
    const items: WikilinkSuggestionItem[] = [
      {
        id: "folder-docs",
        target: "",
        label: "docs",
        path: "",
        kind: "folder-header",
        folder: "docs",
      },
    ];

    expect(completionCandidates(items, "doc")).toEqual([]);
  });

  it("builds heading candidates as title#heading for a zettel note", () => {
    const heading: WikilinkSuggestionItem = {
      id: "heading-0",
      target: "202607051530",
      label: "Background",
      path: "/vault/notes/202607051530 원자적 노트.md",
      kind: "heading",
      heading: "Background",
      headingLevel: 2,
      searchText: "원자적 노트",
    };

    expect(completionCandidates([heading], "원자적 노트#Back")).toEqual([
      "원자적 노트#Background",
    ]);
  });
});

/**
 * §61 상대 경로 모드의 항목 매핑.
 *
 * 이 분기에는 테스트가 하나도 없었고, 그래서 `label`만 접두하고 `searchText`는
 * 두는 회귀가 리뷰까지 살아남았다. 여기서 고정하는 불변식은 하나다:
 * **쿼리와 같은 좌표계에 있어야 하는 값(label·target)에는 접두사가 붙고,
 * 접두사 없는 `fileQuery`로 걸러지는 값(searchText)에는 붙지 않는다.**
 */
describe("§61 namespaceItems — which strings carry the ./ prefix", () => {
  const zettel: WikilinkSuggestionItem = {
    id: "0",
    target: "202607051530",
    label: "원자적 노트",
    path: "/vault/notes/ai/202607051530 원자적 노트.md",
    searchText: "원자적 노트",
  };
  const plain: WikilinkSuggestionItem = {
    id: "1",
    target: "readme",
    label: "readme",
    path: "/vault/notes/ai/readme.md",
  };

  it("prefixes the drawn label and the inserted target, but not the search key", () => {
    const [z] = namespaceItems([zettel], "/vault/notes/ai", "./");

    expect(z.label).toBe("./원자적 노트");
    expect(z.target).toBe("./202607051530");
    expect(z.searchText).toBe("원자적 노트");
  });

  it("keeps every row in the Tab pool — the pool is built from label", () => {
    const items = namespaceItems([zettel, plain], "/vault/notes/ai", "./");

    expect(completionCandidates(items, "./")).toEqual([
      "./원자적 노트",
      "./readme",
    ]);
  });

  it("still filters by the unprefixed file query", () => {
    const items = namespaceItems([zettel, plain], "/vault/notes/ai", "./");

    expect(filterFiles(items, "원자", 20).map((i) => i.target)).toEqual([
      "./202607051530",
    ]);
  });

  it("keeps only files that live in the resolved directory", () => {
    const elsewhere: WikilinkSuggestionItem = {
      id: "2",
      target: "other",
      label: "other",
      path: "/vault/notes/other.md",
    };

    expect(
      namespaceItems([zettel, plain, elsewhere], "/vault/notes/ai", "./"),
    ).toHaveLength(2);
  });

  it("does not mutate the items it was given", () => {
    namespaceItems([zettel], "/vault/notes/ai", "./");

    expect(zettel.label).toBe("원자적 노트");
    expect(zettel.target).toBe("202607051530");
  });
});

/**
 * §87 cross-vault 항목과 §31 heading 항목의 매핑.
 *
 * 리뷰가 실증한 사각지대: 이 두 매핑의 변경을 되돌려도 전체 스위트가 통과했다.
 * Suggestion의 `items` 콜백을 부르는 테스트가 없어서, 그 안에서 만들어지는 항목의
 * 모양은 아무도 보지 않는다.
 */
describe("§87 crossVaultItem", () => {
  it("draws the stem, never the .md filename", () => {
    const item = crossVaultItem(
      { name: "api-design.md", path: "/other/docs/api-design.md" },
      "cross-0",
      "work",
    );

    expect(item.label).toBe("api-design");
    expect(item.target).toBe("api-design");
    expect(item.vaultAlias).toBe("work");
  });

  it("carries the folder through for grouped browsing", () => {
    const item = crossVaultItem(
      { name: "api-design.md", path: "/other/docs/api-design.md" },
      "cross-0",
      "work",
      "docs",
    );

    expect(item.folder).toBe("docs");
  });

  it("leaves folder unset when browsing is flat", () => {
    const item = crossVaultItem(
      { name: "a.md", path: "/other/a.md" },
      "cross-0",
      "work",
    );

    expect(item.folder).toBeUndefined();
  });
});

describe("§31 headingItems", () => {
  const zettel: WikilinkSuggestionItem = {
    id: "0",
    target: "202607051530",
    label: "원자적 노트",
    path: "/vault/notes/202607051530 원자적 노트.md",
    searchText: "원자적 노트",
  };

  it("keeps the file's target so the inserted link is [[id#heading]]", () => {
    const [h] = headingItems(zettel, [
      { text: "Background", level: 2, line: 3 },
    ]);

    expect(h.target).toBe("202607051530");
    expect(h.heading).toBe("Background");
    expect(h.headingLevel).toBe(2);
    expect(h.kind).toBe("heading");
  });

  /**
   * 전파하지 않으면 Tab 후보가 `202607051530#Background`가 되는데 쿼리는
   * `원자적 노트#Back`이라 `startsWith`가 영원히 실패한다 — 조용한 no-op.
   */
  it("carries the file's search key so Tab can complete title#heading", () => {
    const items = headingItems(zettel, [
      { text: "Background", level: 2, line: 3 },
    ]);

    expect(completionCandidates(items, "원자적 노트#Back")).toEqual([
      "원자적 노트#Background",
    ]);
  });

  it("leaves searchText unset for a non-zettel file", () => {
    const plain: WikilinkSuggestionItem = {
      id: "1",
      target: "readme",
      label: "readme",
      path: "/vault/readme.md",
    };
    const [h] = headingItems(plain, [{ text: "Setup", level: 1, line: 1 }]);

    expect(h.searchText).toBeUndefined();
    expect(completionCandidates([h], "readme#Set")).toEqual(["readme#Setup"]);
  });
});

/**
 * §278 자동완성에 올릴 파일의 판정.
 *
 * 규칙은 "**문서 탭에서 텍스트로 볼 수 있는 것**"이다. 해석기
 * (`resolveByExactFileName`)는 확장자 목록을 아예 두지 않아 `[[data.json]]`을 손으로
 * 치면 이미 열린다 — 목록이 좁으면 기능이 있는데 발견 경로가 없는 상태가 된다.
 *
 * ‼️ 이미지·SVG는 **일부러 뺀다**: 마크다운이 `![](...)`로 넣는 자산이라 위키링크
 * 대상이 아니고, 넣으면 vault 대부분이 첨부 파일인 사람에게 목록이 자산으로 덮인다.
 * PDF·HTML은 그 문법으로 넣을 수 없어 남는다.
 */
describe("§278 isLinkableFile", () => {
  const f = (relativePath: string) => ({
    name: relativePath.split("/").pop()!,
    relativePath,
  });
  const linkable = (relativePath: string) => isLinkableFile(f(relativePath));

  it("offers markdown, including .mdx", () => {
    expect(linkable("note.md")).toBe(true);
    expect(linkable("note.markdown")).toBe(true);
    // .mdx는 isMarkdownFile이 마크다운으로 치고 탭도 WYSIWYG로 여는데,
    // 리터럴 endsWith(".md") 판정에서는 빠져 있었다.
    expect(linkable("note.mdx")).toBe(true);
  });

  it("offers code files the editor knows a language for", () => {
    for (const p of ["a.ts", "a.py", "a.toml", "a.yaml", "a.css", "a.sh"]) {
      expect(linkable(p), p).toBe(true);
    }
  });

  /**
   * 제품 판단으로 뺀다 — `.json`은 vault에서 읽는 문서가 아니라 기계가 읽는
   * 데이터(플러그인 매니페스트·설정·인덱스)로 존재하고, 열 수 있다는 것이
   * 링크 대상이라는 뜻은 아니다. `.baram/` 사이드카는 hidden-path 규칙이
   * 따로 막으므로 이 제외의 이유가 아니다 — 되돌린다면 이 한 줄만 지우면 된다.
   */
  it("does NOT offer .json", () => {
    expect(linkable("package.json")).toBe(false);
    expect(linkable("notes/data.json")).toBe(false);
  });

  it("offers plain-text files that have no language", () => {
    for (const p of ["notes.txt", "data.csv", "run.log"]) {
      expect(linkable(p), p).toBe(true);
    }
  });

  it("offers PDF and HTML — markdown has no syntax that embeds them", () => {
    expect(linkable("paper.pdf")).toBe(true);
    expect(linkable("page.html")).toBe(true);
    expect(linkable("page.htm")).toBe(true);
  });

  it("does NOT offer images — markdown embeds those with ![](…)", () => {
    for (const p of ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.avif"]) {
      expect(linkable(p), p).toBe(false);
    }
  });

  it("does NOT offer SVG, even though the editor knows it as xml", () => {
    expect(linkable("logo.svg")).toBe(false);
  });

  /**
   * 열지 못하는 바이너리를 올리면 안 되는 이유는 목록 잡음이 아니다: 탭 표면이
   * 마지막에 `return "code"`로 떨어져 CodeMirror가 UTF-8로 읽고, 자동 저장은
   * `isBinaryViewerFile`만 건너뛰므로 dirty가 되면 **원본을 덮어쓴다**.
   */
  it("does NOT offer binaries the app cannot open as text", () => {
    for (const p of ["archive.zip", "clip.mp4", "font.woff2"]) {
      expect(linkable(p), p).toBe(false);
    }
  });

  /**
   * `.json`을 허용한 순간 이것이 실제 문제가 된다 — flattenFileTree의
   * EXCLUDED_DIRS는 `.DS_Store`·`.git`·`.hg`·`.svn`·`node_modules` 다섯뿐이고
   * `.baram`이 없어서, 하이라이트 사이드카와 스냅샷이 그대로 목록에 뜬다.
   */
  it("does NOT offer files inside a dot-directory", () => {
    expect(linkable(".baram/pdf-highlights/paper.json")).toBe(false);
    expect(linkable(".baram/snapshots/note.md")).toBe(false);
    expect(linkable("notes/.trash/old.md")).toBe(false);
  });

  it("does NOT offer hidden files", () => {
    expect(linkable(".eslintrc.json")).toBe(false);
  });
});
