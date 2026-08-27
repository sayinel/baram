// §313/§5.1 "그 줄로 가라"가 **그 줄**에 내린다.
//
// 결함의 형태: `mdLineToPmPos`의 옛 이름(`mdLineToPmBlockStart`)이 그대로 계약이었다 —
// **최상위 블록의 시작**만 돌려줬다. 목록 하나는 여러 줄이지만 최상위 노드는 하나이므로
// 항목 세 개가 전부 첫 항목으로 접혔고, 블록의 마크다운 구간을 그 블록의 PM **텍스트**로
// 재던 탓에 텍스트가 없는 항목(태그·위키링크만 든 태스크)이 든 목록은 구간이 첫 줄에서
// 끝나 나머지 줄이 **다음 블록**으로 새어 나갔다 — 사용자가 본 "세 번째 항목을 눌렀더니
// 목록 아래 문단으로 갔다"가 그것이다.
//
// 그래서 이 파일은 배선이 아니라 **착지점**만 본다: 커서가 앉은 블록의 텍스트, 또는
// 그 자리에서 시작하는 문서 텍스트.
import type { Node as PmNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { afterAll, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { mdLineToPmPos } from "../editor/cursor-line-mapper";

const editor = new Editor({ extensions: createBaramExtensions(), content: "" });
afterAll(() => editor.destroy());

function doc(md: string): PmNode {
  return markdownToProsemirror(md, editor.schema);
}

/** 커서가 앉은 블록의 텍스트 — 어느 항목에 내렸는지를 말해 준다. */
function landedIn(md: string, line: number): string {
  const d = doc(md);
  const pos = Math.min(mdLineToPmPos(d, md, line), d.content.size);
  return d.resolve(pos).parent.textContent;
}

/** 표에서는 줄 하나가 행 하나다 — 착지한 행의 텍스트를 본다. */
function landedRow(md: string, line: number): string {
  const d = doc(md);
  const $pos = d.resolve(Math.min(mdLineToPmPos(d, md, line), d.content.size));
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "tableRow") return node.textContent;
  }
  return `(no row) ${$pos.parent.textContent}`;
}

/** 착지 지점에서 시작하는 문서 텍스트 — 블록 **안**의 어느 줄인지를 말해 준다. */
function textFrom(md: string, line: number, take: number): string {
  const d = doc(md);
  const pos = Math.min(mdLineToPmPos(d, md, line), d.content.size);
  return d.textBetween(pos, Math.min(pos + take, d.content.size), "\n");
}

describe("mdLineToPmPos — 여러 줄짜리 블록 안으로 내려간다", () => {
  const TASKS = [
    "# Title",
    "",
    "- [ ] first task 📅 2026-08-30",
    "- [ ] second task 📅 2026-08-31",
    "- [ ] third task 📅 2026-09-01",
    "",
    "After the list.",
    "",
  ].join("\n");

  it("태스크 목록의 각 항목이 자기 항목에 내린다", () => {
    expect(landedIn(TASKS, 3)).toBe("first task 📅 2026-08-30");
    expect(landedIn(TASKS, 4)).toBe("second task 📅 2026-08-31");
    expect(landedIn(TASKS, 5)).toBe("third task 📅 2026-09-01");
  });

  it("목록 다음 줄은 목록 밖으로 나간다", () => {
    expect(landedIn(TASKS, 7)).toBe("After the list.");
  });

  it("문서의 첫 줄과 마지막 줄", () => {
    expect(landedIn(TASKS, 1)).toBe("Title");
    expect(landedIn(TASKS, 8)).toBe("After the list.");
  });

  // 사용자가 본 "세 번째를 눌렀더니 목록 아래 문단으로 갔다" — 항목의 내용이 전부
  // 인라인 atom(태그)이라 PM 텍스트가 비어 있고, 블록 구간이 첫 줄에서 끝난다.
  it("PM 텍스트가 없는 항목들(태그만)도 자기 줄에 내린다", () => {
    const md =
      "# T\n\n- [ ] #work\n- [ ] #home\n- [ ] #done\n\nAfter the list.\n";
    const d = doc(md);
    const inList = (line: number) => {
      const $p = d.resolve(
        Math.min(mdLineToPmPos(d, md, line), d.content.size),
      );
      for (let depth = $p.depth; depth > 0; depth--) {
        if ($p.node(depth).type.name === "taskItem") return depth;
      }
      return -1;
    };
    expect(inList(3)).toBeGreaterThan(0);
    expect(inList(4)).toBeGreaterThan(0);
    expect(inList(5)).toBeGreaterThan(0);
    // 세 항목이 서로 다른 자리에 내린다
    const p3 = mdLineToPmPos(d, md, 3);
    const p4 = mdLineToPmPos(d, md, 4);
    const p5 = mdLineToPmPos(d, md, 5);
    expect(new Set([p3, p4, p5]).size).toBe(3);
    expect(landedIn(md, 7)).toBe("After the list.");
  });

  it("글머리 목록", () => {
    const md = "Intro\n\n- one\n- two\n- three\n\nEnd.\n";
    expect(landedIn(md, 3)).toBe("one");
    expect(landedIn(md, 4)).toBe("two");
    expect(landedIn(md, 5)).toBe("three");
    expect(landedIn(md, 7)).toBe("End.");
  });

  it("번호 목록", () => {
    const md = "Intro\n\n1. one\n2. two\n3. three\n\nEnd.\n";
    expect(landedIn(md, 3)).toBe("one");
    expect(landedIn(md, 4)).toBe("two");
    expect(landedIn(md, 5)).toBe("three");
  });

  it("중첩 목록 — 안쪽 항목까지", () => {
    const md = "Intro\n\n- one\n  - one-a\n  - one-b\n- two\n\nEnd.\n";
    expect(landedIn(md, 3)).toBe("one");
    expect(landedIn(md, 4)).toBe("one-a");
    expect(landedIn(md, 5)).toBe("one-b");
    expect(landedIn(md, 6)).toBe("two");
    expect(landedIn(md, 8)).toBe("End.");
  });

  it("여러 줄짜리 인용문 — 블록 안의 그 줄에서 시작한다", () => {
    const md = "Intro\n\n> line A\n> line B\n> line C\n\nEnd.\n";
    expect(textFrom(md, 3, 6)).toBe("line A");
    expect(textFrom(md, 4, 6)).toBe("line B");
    expect(textFrom(md, 5, 6)).toBe("line C");
    expect(landedIn(md, 7)).toBe("End.");
  });

  it("코드 펜스 — 블록 안의 그 줄에서 시작한다", () => {
    const md = "Intro\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\nEnd.\n";
    expect(textFrom(md, 3, 12)).toBe("const a = 1;");
    expect(textFrom(md, 4, 12)).toBe("const a = 1;");
    expect(textFrom(md, 5, 12)).toBe("const b = 2;");
    expect(landedIn(md, 8)).toBe("End.");
  });

  it("표 — 줄 하나가 행 하나다", () => {
    const md =
      "Intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nEnd.\n";
    expect(landedRow(md, 3)).toBe("ab");
    expect(landedRow(md, 5)).toBe("12");
    expect(landedRow(md, 6)).toBe("34");
    expect(landedIn(md, 8)).toBe("End.");
  });

  // 셀이 비어 있으면 표의 PM 텍스트는 머리글뿐이다 — 글자 맞추기는 첫 줄에서 끝나므로
  // 나머지 줄은 바닥(행 수 + 구분자 줄 하나)만이 붙잡는다.
  it("셀이 빈 표에서도 각 줄이 자기 행에 내린다", () => {
    const md = "Intro\n\n| a | b |\n| --- | --- |\n|  |  |\n|  |  |\n\nEnd.\n";
    expect(landedRow(md, 5)).not.toContain("no row");
    expect(landedRow(md, 6)).not.toContain("no row");
    expect(landedIn(md, 8)).toBe("End.");
  });

  // 앞 블록의 글자 맞추기가 **줄 중간**에서 끝나는 경우(제목 끝의 태그처럼 PM 텍스트가
  // 없는 꼬리가 남는다). 그 줄은 다음 블록의 것이 아니므로 바닥 계산에서 세면 안 된다 —
  // 세면 목록이 자기 줄을 하나 덜 먹고 마지막 항목이 다음 블록으로 샌다.
  it("앞 블록이 줄 중간에서 끝나도 목록이 자기 줄을 다 먹는다", () => {
    const md =
      "# Today #work\n\n- [ ] #a\n- [ ] #b\n- [ ] #c\n\nAfter the list.\n";
    const d = doc(md);
    const inTaskItem = (line: number) => {
      const $p = d.resolve(
        Math.min(mdLineToPmPos(d, md, line), d.content.size),
      );
      for (let depth = $p.depth; depth > 0; depth--) {
        if ($p.node(depth).type.name === "taskItem") return true;
      }
      return false;
    };
    expect(inTaskItem(3)).toBe(true);
    expect(inTaskItem(4)).toBe(true);
    expect(inTaskItem(5)).toBe(true);
    expect(landedIn(md, 7)).toBe("After the list.");
  });

  it("빈 문서와 범위 밖 줄 번호에서도 유효한 위치를 준다", () => {
    const md = "Only line.\n";
    const d = doc(md);
    expect(mdLineToPmPos(d, md, 0)).toBeGreaterThanOrEqual(0);
    expect(mdLineToPmPos(d, md, 99)).toBeLessThanOrEqual(d.content.size);
    expect(landedIn(md, 1)).toBe("Only line.");
    expect(landedIn(md, 99)).toBe("Only line.");
  });
});
