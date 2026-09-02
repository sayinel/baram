import type { NoteCandidate } from "../capture-target";

import { resolveCaptureTargets } from "../capture-target";

function note(filename: string, content: string): NoteCandidate {
  return { content, filename, path: `/v/Zettel/notes/${filename}` };
}

const 영감노트 = note(
  "202609021015 영감노트.md",
  `---\nid: 202609021015\ntitle: 영감노트\naliases: []\n---\n\n# 영감노트\n\n#Note #영감노트\n`,
);
const devNote = note(
  "202609021016 Baram Dev Note.md",
  `---\ntitle: Baram Dev Note\naliases: [Baram-Dev-Note]\n---\n\n# Baram Dev Note\n`,
);
const links = note(
  "202609021017 Links.md",
  `---\ntitle: Links\n---\n\n# Links\n`,
);

describe("resolveCaptureTargets", () => {
  it("matches a note by its title", () => {
    expect(resolveCaptureTargets(["영감노트"], [영감노트, links])).toEqual([
      { matchedTag: "영감노트", path: 영감노트.path, title: "영감노트" },
    ]);
  });

  it("matches a note by a frontmatter alias", () => {
    expect(resolveCaptureTargets(["Baram-Dev-Note"], [devNote])).toEqual([
      {
        matchedTag: "Baram-Dev-Note",
        path: devNote.path,
        title: "Baram Dev Note",
      },
    ]);
  });

  // ‼️ 자동완성 출처(`getVaultTags`)가 태그를 **소문자로** 정규화한다
  // (`src-tauri/src/tag/mod.rs:126`·`:135`). 제안을 고른 사용자는 `#links`를 얻고,
  // 노트 제목은 `Links`다. 대소문자를 구분하면 제안대로 고른 태그가 매칭에 실패한다.
  it("matches case-insensitively, ignoring surrounding whitespace", () => {
    expect(resolveCaptureTargets(["  links  "], [links])).toEqual([
      { matchedTag: "  links  ", path: links.path, title: "Links" },
    ]);
  });

  // ‼️ 공백이 있는 제목은 태그로 직접 닿을 수 없다 — 별칭만이 길이다(§320).
  it("does not match a whitespace-bearing title through a tag", () => {
    expect(resolveCaptureTargets(["Baram Dev Note"], [devNote])).toEqual([]);
    expect(resolveCaptureTargets(["Baram"], [devNote])).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(resolveCaptureTargets(["영감노드"], [영감노트, links])).toEqual([]);
    expect(resolveCaptureTargets([], [영감노트])).toEqual([]);
  });

  // §320: 둘 이상 매칭되면 모두에 붙는다. Logseq에서 태그를 여러 개 달면 각 페이지
  // 백링크에 모두 나타났던 것과 같은 의미론이다.
  it("returns every matching note, not just the first", () => {
    const out = resolveCaptureTargets(["영감노트", "Links"], [영감노트, links]);
    expect(out.map((t) => t.title).sort()).toEqual(["Links", "영감노트"]);
  });

  // ‼️ 같은 노트를 두 경로(제목·별칭)로 지목해도 **한 번만** 붙는다. 중복 append는
  // 같은 항목을 문서에 두 번 남기고, 블록 ID까지 중복시킨다.
  it("does not append twice when two tags name the same note", () => {
    const both = note(
      "202609021018 Links.md",
      `---\ntitle: Links\naliases: [Link]\n---\n`,
    );
    expect(resolveCaptureTargets(["links", "link"], [both])).toHaveLength(1);
  });

  it("strips a leading id from the filename when deriving the title", () => {
    const bare = note("202609021019 강연.md", `# 강연\n`); // frontmatter 없음
    expect(resolveCaptureTargets(["강연"], [bare])).toEqual([
      { matchedTag: "강연", path: bare.path, title: "강연" },
    ]);
  });
});
