import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ({ listDir, readFile }));

import {
  idForTitle,
  maybeRefreshForPath,
  refreshZettelIndex,
  titleForId,
  useZettelIndexStore,
} from "../zettel-index";

describe("zettel index", () => {
  beforeEach(() => useZettelIndexStore.getState().clear());

  it("builds id→title from notes/ + inbox/ and resolves both directions", async () => {
    listDir.mockImplementation(async (dir: string) =>
      dir.endsWith("/notes")
        ? [
            {
              name: "202607051530 원자적 노트.md",
              path: `${dir}/202607051530 원자적 노트.md`,
            },
          ]
        : [{ name: "202607051600.md", path: `${dir}/202607051600.md` }],
    );
    readFile.mockResolvedValue("no frontmatter");
    await refreshZettelIndex("/z");
    expect(titleForId("202607051530")).toBe("원자적 노트");
    expect(idForTitle("원자적 노트")).toBe("202607051530");
    // §99 fleeting: 파일명에도 프론트매터에도 제목이 없다 → 본문 첫 줄이 이름이다.
    expect(titleForId("202607051600")).toBe("no frontmatter");
  });

  /**
   * §99 퀵캡처가 만드는 fleeting 노트는 `{id}.md` + `title:` 없는 프론트매터라
   * `parseNoteTitle`이 **ID 자체**를 돌려준다. 그러면 인덱스를 읽는 네 표면
   * (자동완성 목록·검색 키·`[[id]]` pill·export)이 모두 12자리 숫자를 이름으로
   * 보여 준다 — §95의 "사용자는 ID를 타이핑/열람하지 않음"이 깨지는 자리다.
   * 허브 inbox(§103)는 이미 본문 첫 줄로 이 구멍을 메우고 있었다.
   */
  describe("§99 fleeting notes have no title — fall back to the first body line", () => {
    const fleeting = async (content: string) => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/inbox")
          ? [{ name: "202609061000.md", path: `${dir}/202609061000.md` }]
          : [],
      );
      readFile.mockResolvedValue(content);
      await refreshZettelIndex("/z");
    };

    it("names a fleeting note by its first body line, not its id", async () => {
      await fleeting(
        "---\nid: 202609061000\ncreated: 2026-09-06T10:00\ntags: []\n---\n\n논문 읽다 떠오른 생각\n",
      );
      expect(titleForId("202609061000")).toBe("논문 읽다 떠오른 생각");
    });

    it("makes a fleeting note reachable by that name", async () => {
      await fleeting("---\nid: 202609061000\n---\n\n논문 읽다 떠오른 생각\n");
      expect(idForTitle("논문 읽다 떠오른 생각")).toBe("202609061000");
    });

    it("keeps the id when the body is empty — there is nothing better to show", async () => {
      await fleeting("---\nid: 202609061000\ntags: []\n---\n\n");
      expect(titleForId("202609061000")).toBe("202609061000");
    });

    it("keeps the id when the file cannot be read", async () => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/inbox")
          ? [{ name: "202609061000.md", path: `${dir}/202609061000.md` }]
          : [],
      );
      readFile.mockRejectedValue(new Error("EACCES"));
      await refreshZettelIndex("/z");
      expect(titleForId("202609061000")).toBe("202609061000");
    });

    /**
     * 폴백은 **이름이 없을 때만** 끼어든다. 허브(`firstBodyLine(content) || ...`)는
     * 본문 첫 줄을 프론트매터 제목보다 우선하지만, 인덱스의 title은 `[[id]]` pill과
     * export가 읽는 값이라 §95의 "현재 제목"(= 프론트매터 title 우선)을 유지해야 한다.
     */
    it("does NOT override a real frontmatter title with the first body line", async () => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/notes")
          ? [{ name: "202607051530.md", path: `${dir}/202607051530.md` }]
          : [],
      );
      readFile.mockResolvedValue(
        "---\nid: 202607051530\ntitle: 원자적 노트\n---\n\n첫 줄은 제목이 아니다\n",
      );
      await refreshZettelIndex("/z");
      expect(titleForId("202607051530")).toBe("원자적 노트");
    });

    /**
     * 폴백 조건은 "**적어 둔 제목이 없다**"이지 "해석된 제목이 우연히 id와 같다"가
     * 아니다. 제목이 ID 문자열과 같은 노트는 인위적이지만, 술어가 그 둘을 구별하지
     * 못하면 주석에 적힌 불변식이 거짓이 되고 다음 사람이 그 문장을 믿는다.
     */
    it("does NOT override a frontmatter title that happens to BE the id", async () => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/notes")
          ? [
              {
                name: "202607051530 회의록.md",
                path: `${dir}/202607051530 회의록.md`,
              },
            ]
          : [],
      );
      readFile.mockResolvedValue(
        "---\ntitle: 202607051530\n---\n\n본문 첫 줄이 제목을 덮는가\n",
      );
      await refreshZettelIndex("/z");
      expect(titleForId("202607051530")).toBe("202607051530");
    });

    it("does NOT override a filename title that happens to BE the id", async () => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/notes")
          ? [
              {
                name: "202607051530 202607051530.md",
                path: `${dir}/202607051530 202607051530.md`,
              },
            ]
          : [],
      );
      readFile.mockResolvedValue("본문 첫 줄이 제목을 덮는가\n");
      await refreshZettelIndex("/z");
      expect(titleForId("202607051530")).toBe("202607051530");
    });

    it("does NOT override a title carried by the filename", async () => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/notes")
          ? [
              {
                name: "202607051530 원자적 노트.md",
                path: `${dir}/202607051530 원자적 노트.md`,
              },
            ]
          : [],
      );
      readFile.mockResolvedValue("첫 줄은 제목이 아니다\n");
      await refreshZettelIndex("/z");
      expect(titleForId("202607051530")).toBe("원자적 노트");
    });
  });

  /**
   * §99 본문 첫 줄 폴백은 fleeting 노트를 제목 네임스페이스에 **새로** 밀어 넣는다.
   * `idForTitle`은 유일 매칭일 때만 id를 주므로, 퀵캡처 본문이 기존 노트 제목과
   * 겹치는 순간 B2 eager 정규화(`wikilink.ts` InputRule/paste)가 조용히 멈추고
   * `[[회의록]]`이 dangling 링크로 남는다. 퀵캡처는 짧아 첫 줄이 곧 캡처 전체라
   * 한 단어 겹침("회의록", "TODO", 사람 이름)은 드문 입력이 아니다.
   *
   * 그래서 **적어 둔 이름이 파생된 이름을 이긴다**: 프론트매터·파일명의 제목은
   * 사용자가 그 노트를 부르려고 정한 것이고, 본문 첫 줄은 그 노트를 부를 이름이
   * 달리 없어서 빌려온 것이다.
   */
  describe("§99 an authored title outranks one derived from a body line", () => {
    const both = async (body: string) => {
      listDir.mockImplementation(async (dir: string) =>
        dir.endsWith("/notes")
          ? [
              {
                name: "202607051530 회의록.md",
                path: `${dir}/202607051530 회의록.md`,
              },
            ]
          : [{ name: "202609061000.md", path: `${dir}/202609061000.md` }],
      );
      readFile.mockImplementation(async (path: string) =>
        path.includes("/inbox/") ? body : "본문",
      );
      await refreshZettelIndex("/z");
    };

    it("resolves to the authored note when a capture's first line collides", async () => {
      await both("회의록");
      expect(titleForId("202609061000")).toBe("회의록");
      expect(idForTitle("회의록")).toBe("202607051530");
    });

    it("still resolves a capture by its first line when nothing else claims it", async () => {
      await both("장보기");
      expect(idForTitle("장보기")).toBe("202609061000");
    });

    it("stays ambiguous when two AUTHORED titles collide (unchanged)", () => {
      useZettelIndexStore.getState().setAll([
        { id: "1", path: "a", title: "dup" },
        { id: "2", path: "b", title: "dup" },
      ]);
      expect(idForTitle("dup")).toBeNull();
    });

    it("stays ambiguous when two DERIVED titles collide", () => {
      useZettelIndexStore.getState().setAll([
        { id: "1", path: "a", title: "dup", titleFromBody: true },
        { id: "2", path: "b", title: "dup", titleFromBody: true },
      ]);
      expect(idForTitle("dup")).toBeNull();
    });
  });

  it("idForTitle returns null when ambiguous", () => {
    useZettelIndexStore.getState().setAll([
      { id: "1", path: "a", title: "dup" },
      { id: "2", path: "b", title: "dup" },
    ]);
    expect(idForTitle("dup")).toBeNull();
  });
});

describe("maybeRefreshForPath", () => {
  beforeEach(() => {
    useZettelIndexStore.getState().clear();
    listDir.mockReset();
    readFile.mockReset();
  });

  it("refreshes when opening a path under the zettel dir while the index is empty", async () => {
    listDir.mockImplementation(async (dir: string) =>
      dir.endsWith("/notes")
        ? [
            {
              name: "202607051530 title.md",
              path: `${dir}/202607051530 title.md`,
            },
          ]
        : [],
    );
    readFile.mockResolvedValue("no frontmatter");

    await maybeRefreshForPath("/z/notes/202607051530 title.md", "/z");

    expect(titleForId("202607051530")).toBe("title");
  });

  it("does nothing for a path outside the zettel dir", async () => {
    await maybeRefreshForPath("/other/notes/foo.md", "/z");

    expect(listDir).not.toHaveBeenCalled();
    expect(Object.keys(useZettelIndexStore.getState().byId)).toHaveLength(0);
  });

  it("does nothing when the index is already populated", async () => {
    useZettelIndexStore
      .getState()
      .setAll([{ id: "1", path: "/z/notes/a.md", title: "a" }]);

    await maybeRefreshForPath("/z/notes/b.md", "/z");

    expect(listDir).not.toHaveBeenCalled();
    expect(titleForId("1")).toBe("a");
  });

  it("does nothing when zettelDir is null", async () => {
    await maybeRefreshForPath("/z/notes/foo.md", null);

    expect(listDir).not.toHaveBeenCalled();
  });
});
