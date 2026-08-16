import { beforeEach, describe, expect, it } from "vitest";

// §95 Zettelkasten: [[ autocomplete searches by title, inserts id
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import {
  buildFileSuggestionItem,
  filterFiles,
  isCreatableTarget,
  shouldBlockCompletedWikilink,
  type WikilinkSuggestionItem,
  withMarkdownExtension,
} from "../wikilink-suggest-utils";

describe("wikilink-suggest-utils — §95 zettel autocomplete", () => {
  beforeEach(() => useZettelIndexStore.getState().clear());

  describe("buildFileSuggestionItem", () => {
    it("zettel-note file (id-prefixed filename): target=id, searchText=title from index", () => {
      useZettelIndexStore.getState().setAll([
        {
          id: "202607051530",
          path: "/vault/notes/202607051530 원자적 노트.md",
          title: "원자적 노트",
        },
      ]);

      const item = buildFileSuggestionItem(
        {
          name: "202607051530 원자적 노트.md",
          path: "/vault/notes/202607051530 원자적 노트.md",
        },
        "0",
      );

      expect(item.target).toBe("202607051530");
      expect(item.searchText).toBe("원자적 노트");
      expect(item.label).toBe("원자적 노트");
    });

    it("zettel-note file falls back to parseNoteTitle when not in the index", () => {
      const item = buildFileSuggestionItem(
        {
          name: "202607060000 미색인 노트.md",
          path: "/vault/inbox/202607060000 미색인 노트.md",
        },
        "1",
      );

      expect(item.target).toBe("202607060000");
      expect(item.searchText).toBe("미색인 노트");
      expect(item.label).toBe("미색인 노트");
    });

    it("regular (non-zettel) file: target=filename, no searchText", () => {
      const item = buildFileSuggestionItem(
        { name: "daily-notes.md", path: "/vault/daily-notes.md" },
        "2",
      );

      expect(item.target).toBe("daily-notes");
      expect(item.searchText).toBeUndefined();
      expect(item.label).toBe("daily-notes.md");
    });
  });

  describe("filterFiles", () => {
    it("matches zettel items by title (searchText), not by the raw id", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "202607051530",
          label: "원자적 노트",
          path: "/vault/notes/202607051530 원자적 노트.md",
          searchText: "원자적 노트",
        },
      ];

      expect(filterFiles(files, "원자적", 20)).toHaveLength(1);
      expect(filterFiles(files, "202607051530", 20)).toHaveLength(0);
    });

    it("matches regular files by filename (target), unchanged behavior", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "daily-notes",
          label: "daily-notes.md",
          path: "/vault/daily-notes.md",
        },
      ];

      expect(filterFiles(files, "daily", 20)).toHaveLength(1);
      expect(filterFiles(files, "zzz", 20)).toHaveLength(0);
    });

    it("empty query returns the slice as-is (existing behavior preserved)", () => {
      const files: WikilinkSuggestionItem[] = [
        {
          id: "0",
          target: "202607051530",
          label: "원자적 노트",
          path: "/vault/notes/202607051530 원자적 노트.md",
          searchText: "원자적 노트",
        },
        {
          id: "1",
          target: "daily-notes",
          label: "daily-notes.md",
          path: "/vault/daily-notes.md",
        },
      ];

      expect(filterFiles(files, "", 20)).toHaveLength(2);
    });
  });
});

describe("shouldBlockCompletedWikilink — bugfix for pasted [[wikilink]] triggering autocomplete", () => {
  it("blocks when matched text contains a closing ]] (complete/pasted wikilink)", () => {
    expect(shouldBlockCompletedWikilink("[[blanky]]")).toBe(true);
  });

  it("blocks even with a heading/alias inside a complete wikilink", () => {
    expect(shouldBlockCompletedWikilink("[[blanky#Section]]")).toBe(true);
    expect(shouldBlockCompletedWikilink("[[vault::blanky]]")).toBe(true);
  });

  it("allows an in-progress query with no closing ]]", () => {
    expect(shouldBlockCompletedWikilink("[[blan")).toBe(false);
  });

  it("allows an empty query right after typing [[", () => {
    expect(shouldBlockCompletedWikilink("[[")).toBe(false);
  });
});

describe("§278 type badge — telling a PDF from its highlight companion note", () => {
  // companionPathFor()가 `papers/x.pdf` → `highlights/papers/x.md`로 만들기 때문에
  // 둘은 **설계상** 이름이 같다. 메뉴가 그리는 문자열의 구분 정보(`.pdf`)는 맨
  // 끝에 있고 .wikilink-item-label의 말줄임은 끝에서 자르므로, 이름이 길면
  // 화면에 남는 단서가 사라진다. 배지는 그 단서를 줄어들지 않는 자리로 옮긴다.

  it("마크다운에는 배지가 없다 — 배지 없는 줄이 곧 노트라는 규칙", () => {
    const md = buildFileSuggestionItem(
      { name: "attention-is-all-you-need.md", path: "/v/highlights/a.md" },
      "0",
    );
    expect(md.ext).toBeUndefined();

    const markdown = buildFileSuggestionItem(
      { name: "ideas.markdown", path: "/v/ideas.markdown" },
      "1",
    );
    expect(markdown.ext).toBeUndefined();
  });

  it("PDF에는 배지가 붙는다", () => {
    const pdf = buildFileSuggestionItem(
      { name: "attention-is-all-you-need.pdf", path: "/v/papers/a.pdf" },
      "2",
    );
    expect(pdf.ext).toBe("PDF");
  });

  it("배지는 대문자로 정규화된다 — 파일명 대소문자와 무관하게 한 모양", () => {
    const upper = buildFileSuggestionItem(
      { name: "Survey.PDF", path: "/v/papers/Survey.PDF" },
      "3",
    );
    expect(upper.ext).toBe("PDF");
  });

  it("타입을 열거하지 않는다 — 뷰어가 생기면 배지도 따라온다", () => {
    expect(
      buildFileSuggestionItem({ name: "f.png", path: "/v/f.png" }, "4").ext,
    ).toBe("PNG");
    expect(
      buildFileSuggestionItem({ name: "d.html", path: "/v/d.html" }, "5").ext,
    ).toBe("HTML");
  });

  it("숨김 파일의 선행 점은 확장자가 아니다", () => {
    // ".gitignore"의 lastIndexOf(".")는 0이다 — 그것을 확장자로 읽으면
    // "GITIGNORE" 배지가 붙는다.
    expect(
      buildFileSuggestionItem(
        { name: ".gitignore", path: "/v/.gitignore" },
        "6",
      ).ext,
    ).toBeUndefined();
    // 확장자가 아예 없는 파일도 마찬가지.
    expect(
      buildFileSuggestionItem({ name: "LICENSE", path: "/v/LICENSE" }, "7").ext,
    ).toBeUndefined();
  });

  it("id 접두사가 붙은 비-md 파일도 배지를 받는다", () => {
    // 두 분기 중 한쪽만 배지를 달면, 하필 이름이 긴 그 항목이 구분되지 않는다.
    const item = buildFileSuggestionItem(
      {
        name: "202607051530 논문 스캔.pdf",
        path: "/v/papers/202607051530 논문 스캔.pdf",
      },
      "8",
    );
    expect(item.ext).toBe("PDF");
  });
});

describe("§278.2 the Create option must not invent a file the link cannot reach", () => {
  // `[[Paper.pdf]]`를 타이핑할 수 있게 되면서 생긴 코너다. 매치가 없을 때 메뉴는
  // "Create"를 제안했고, 그것을 고르면 `# Paper.pdf` 내용의 **`Paper.pdf.md`** 가
  // 만들어졌다 — 삽입된 링크 `[[Paper.pdf]]`가 가리키는 파일이 아니다.

  it("뷰어로 여는 타입은 생성 대상이 아니다", () => {
    // 앱은 메뉴에서 PDF나 이미지를 만들 수 없다. 그럴듯한 무언가를 만드는 대신
    // 선택지를 거둔다.
    expect(isCreatableTarget("Paper.pdf")).toBe(false);
    expect(isCreatableTarget("figure-1.png")).toBe(false);
    expect(isCreatableTarget("design.html")).toBe(false);
  });

  it("평범한 노트 이름은 그대로 생성 대상이다", () => {
    // ‼️ 반대 방향. 이 억제가 과하게 걸리면 기존 기능(새 노트 만들기)이 죽는다.
    expect(isCreatableTarget("새 회의록")).toBe(true);
    expect(isCreatableTarget("architecture")).toBe(true);
    expect(isCreatableTarget("v1.2 회의록")).toBe(true); // 이름 속의 점
    expect(isCreatableTarget("notes/todo")).toBe(true);
  });

  it("확장자를 이미 적었으면 .md를 또 붙이지 않는다", () => {
    // 기존 결함: `[[architecture.md]]` → architecture.md.md 가 만들어졌다.
    expect(withMarkdownExtension("architecture.md")).toBe("architecture.md");
    expect(withMarkdownExtension("ideas.markdown")).toBe("ideas.markdown");
    expect(withMarkdownExtension("Notes.MD")).toBe("Notes.MD");
  });

  it("확장자가 없으면 .md를 붙인다", () => {
    expect(withMarkdownExtension("architecture")).toBe("architecture.md");
    expect(withMarkdownExtension("v1.2 회의록")).toBe("v1.2 회의록.md");
  });
});
