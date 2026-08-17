// §278.1 §89 단독 파일 창의 인라인 링크 처리.
//
// ‼️ 소스를 읽어서 단정한다. FileEditorLayout을 렌더하려면 마운트 시점의 IPC
// (readFile·watchDir·ensureFileContext)를 전부 흉내 내야 하는데, 그러면 검증하려는
// 성질이 아니라 목(mock) 배선을 검증하게 된다. 지키려는 것은 한 줄짜리 계약이므로
// 그 줄을 직접 읽는다 — 대신 검색 창을 `createBaramExtensions` 호출로 좁히고
// 매치 개수를 단정해서, 파일 어딘가의 다른 문자열이 통과시키지 못하게 한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isMarkdownHref } from "../../../utils/editor/local-link-nav";

const SOURCE = readFileSync(
  join(__dirname, "..", "FileEditorLayout.tsx"),
  "utf8",
);

describe("§278.1 §89 standalone window link handling", () => {
  it("claims markdown hrefs rather than declining them to the OS opener", () => {
    // 이 창은 네비게이션이 전부 no-op이다. `() => false`로 되돌리면 §278.1 이전에
    // 삼켜지던 `[x](/other/note.md)`가 절대 경로를 OS에 넘기게 된다 — 링크를
    // 아무것도 열지 못하는 창에서 새로 생기는 능력이다.
    const calls = SOURCE.match(/onNavigateLocal:\s*([^\n]*)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("isMarkdownHref");
  });

  it("uses the same predicate the pre-§278.1 Link mark applied", () => {
    // 위 단정은 이름만 본다. 그 이름이 가리키는 함수가 실제로 마크다운만
    // 인정하는지는 여기서 고정한다 — 예전 isLocalFileLink의 확장자 규칙 그대로.
    expect(isMarkdownHref("note.md")).toBe(true);
    expect(isMarkdownHref("note.markdown")).toBe(true);
    expect(isMarkdownHref("www.example.com")).toBe(false);
    expect(isMarkdownHref("Paper.pdf")).toBe(false);
  });
});
