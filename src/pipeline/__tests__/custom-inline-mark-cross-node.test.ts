import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// §5.1 커스텀 인라인 마크(`==` `~` `^`)가 **다른 인라인 마크를 감쌀 때**도 되읽힌다.
//
// 왜 이 테스트가 있는가: `CUSTOM_MARK_PATTERNS`는 텍스트 노드 **하나**에 거는
// 정규식이다. mdast는 `==**b**==`를 `text("==") strong text("==")`로 쪼개므로 어느
// 조각에도 완전한 짝이 없어 하이라이트가 아예 만들어지지 않았다. 마크가 사라진 채
// 저장되면 다음 저장이 `\==**b**==`를 써서, 열고 저장만 해도 파일이 손상됐다.
// `convert-inline-custom-marks.ts`의 `normalizeCrossNodeCustomMarks`가 이 짝을 이제 잡는다.
//
// ‼️ **바이트만 보면 안 된다.** `^**b**^`는 마크를 잃고도 출력이 입력과 **같았다** —
// 순진한 라운드트립 단정은 초록으로 통과한다. 그래서 여기서는 마크를 직접 센다.
const editor = new Editor({ content: "", extensions: createBaramExtensions() });
const schema = editor.schema;

/** 문단의 인라인 조각을 `[텍스트, 마크이름…]`로 납작하게 만든다 */
function inlineShape(doc: PMNode): [string, string[]][] {
  const out: [string, string[]][] = [];
  doc.descendants((node) => {
    if (!node.isText) return;
    out.push([node.text ?? "", node.marks.map((m) => m.type.name).sort()]);
  });
  return out;
}

function parse(markdown: string): PMNode {
  return markdownToProsemirror(markdown, schema);
}

function roundtrip(markdown: string): string {
  return prosemirrorToMarkdown(parse(markdown));
}

describe("커스텀 인라인 마크가 다른 마크를 감쌀 때 (§5.1)", () => {
  it.each([
    ["강조", "==**b**==\n", "highlight", "bold"],
    ["기울임", "==*i*==\n", "highlight", "italic"],
    ["인라인 코드", "==`c`==\n", "highlight", "code"],
    ["링크", "==[l](https://example.com)==\n", "highlight", "link"],
    ["아래첨자 + 강조", "~**b**~\n", "subscript", "bold"],
    ["아래첨자 + 코드", "~`c`~\n", "subscript", "code"],
    ["위첨자 + 강조", "^**b**^\n", "superscript", "bold"],
    ["위첨자 + 코드", "^`c`^\n", "superscript", "code"],
  ])("%s — 두 마크가 모두 만들어진다", (_label, input, outer, inner) => {
    const shape = inlineShape(parse(input));
    expect(shape).toHaveLength(1);
    expect(shape[0][1]).toEqual([outer, inner].sort());
  });

  it("구간이 여러 노드에 걸쳐도 하나의 마크가 된다", () => {
    // `x `, `y`(강조), ` z` 세 조각 전부가 하이라이트여야 한다. 조각마다 따로
    // 감싸면 `a ==x ==<mark>**y**</mark>== z== b`가 나왔다.
    expect(inlineShape(parse("a ==x **y** z== b\n"))).toEqual([
      ["a ", []],
      ["x ", ["highlight"]],
      ["y", ["bold", "highlight"]],
      [" z", ["highlight"]],
      [" b", []],
    ]);
    expect(roundtrip("a ==x **y** z== b\n")).toBe(
      "a <mark>x **y** z</mark> b\n",
    );
  });

  it("이웃한 두 마크를 하나로 삼키지 않는다", () => {
    // 짝짓기 회귀: 여는 쪽을 **건너뛰어** 더 먼 구분자와 짝지으면 그 사이의 짝이
    // 통째로 먹힌다. 실제로 `== and ==`가 한 짝으로 소비돼 하이라이트 둘이 하나로
    // 합쳐지고 ` and `까지 강조됐다. ` and `에 마크가 없어야 한다.
    expect(inlineShape(parse("==**b**== and ==plain==\n"))).toEqual([
      ["b", ["bold", "highlight"]],
      [" and ", []],
      ["plain", ["highlight"]],
    ]);
    expect(inlineShape(parse("^**b**^ and ^c^\n"))).toEqual([
      ["b", ["bold", "superscript"]],
      [" and ", []],
      ["c", ["superscript"]],
    ]);
  });

  it("마크를 실을 수 없는 노드를 감싸면 구분자를 글자 그대로 둔다", () => {
    // 이미지·수식은 PM에서 독립 노드라 이 마크를 실을 수 없다. 그런데도 구분자를
    // 태그로 바꿔 버리면 마크는 PM이 버리고 구분자 문자는 이미 지워진 뒤라,
    // 사용자가 친 `==`가 흔적 없이 사라진다 — 실제로 `==![img](x.png)==`가
    // `![img](x.png)`가 됐다. 뜻을 못 살릴 바에는 바이트를 지킨다.
    for (const input of [
      // 형제 노드로 오는 것
      "==![img](x.png)==\n",
      "~![img](x.png)~\n",
      "^![img](x.png)^\n",
      "==$x^2$==\n",
      "==a ![img](x.png) b==\n",
      // 텍스트처럼 보이지만 분리기가 노드로 바꾸는 것 — 같은 부류의 두 번째 입구다.
      // 이걸 빼먹으면 하이라이트가 `**b** `에만 걸리고 뒤의 `==`가 사라진다.
      "==**b** [[wl]]==\n",
      "==**b** #tag==\n",
      "==**b** @[[m]]==\n",
      "==[[wl]] **b**==\n",
      // 래퍼 **안에** 중첩된 것도 같다. 형제 자리만 보던 판정이 여기서 뚫렸다 —
      // `==**[[wl]]** b==` 가 `[[wl]]== b==` 가 되어 고아 `==` 를 남겼고, 그 파일을
      // 다시 열면 `== b==` 가 **새 하이라이트**로 읽혔다.
      "==**[[wl]]** b==\n",
      "==*[[wl]]* b==\n",
      "==**#tag** b==\n",
      "==~~[[wl]]~~ b==\n",
      "~**[[wl]]** b~\n",
      "^**[[wl]]** b^\n",
    ]) {
      // 커스텀 마크는 만들어지지 않는다. (bold 같은 정상 마크는 그대로 남는다 —
      // `**b**`가 굵은 것은 맞다.)
      const marks = inlineShape(parse(input)).flatMap(([, m]) => m);
      expect(marks, input).not.toContain("highlight");
      expect(marks, input).not.toContain("subscript");
      expect(marks, input).not.toContain("superscript");
      // 그리고 **구분자가 하나도 사라지지 않아야 한다**(이스케이프는 무방).
      // 바이트 전체를 단정하지는 않는다 — `==**[[wl]]** b==` 의 `**` 손실은 main에도
      // 있는 별개의 기존 결함이고, 여기서 지키려는 것은 구분자 소실이다.
      const delim = input.startsWith("~")
        ? "~"
        : input.startsWith("^")
          ? "^"
          : "==";
      const count = (t: string) => t.split(delim).length - 1;
      expect(count(roundtrip(input).replace(/\\/g, "")), input).toBe(
        count(input),
      );
    }
  });

  it("노드처럼 생겼지만 평문인 것은 정상적으로 마크가 걸린다", () => {
    // 판정은 타입 열거가 아니라 **실제 변환 결과**다. `((abc123))` 는 블록 참조
    // 문법에 맞지 않아 노드가 되지 않으므로, 마크를 실을 수 있다. 열거식 가드라면
    // `((` 를 보고 무조건 거절해 사용자의 하이라이트를 잃었을 것이다.
    expect(inlineShape(parse("==**b** ((abc123))==\n"))).toEqual([
      ["b", ["bold", "highlight"]],
      [" ((abc123))", ["highlight"]],
    ]);
  });

  it("짝이 없는 구분자는 마크를 만들지 않는다", () => {
    for (const input of ["==unclosed\n", "^unclosed\n", "a = b\n", "a ^ b\n"]) {
      const marks = inlineShape(parse(input)).flatMap(([, m]) => m);
      expect(marks, input).toEqual([]);
    }
  });
});

describe("기존 동작이 바뀌지 않는다 (§5.1)", () => {
  // 단축 구문으로 적힌 평문은 사용자 파일의 절대다수다. 형태가 바뀌면 열고 저장만
  // 해도 전부 다시 쓰이므로, 바이트가 그대로여야 한다.
  it.each([
    ["평문 강조", "==plain==\n"],
    ["앞뒤 공백을 품은 강조", "== a ==\n"],
    ["한 줄에 여럿", "==a== and ==b==\n"],
    ["세 종류 혼재", "==highlight== with ^super^ and ~sub~\n"],
    ["제목 안", "## ==highlighted== heading\n"],
    ["아래첨자 관용구", "H~2~O is water\n"],
    ["위첨자 관용구", "E = mc^2^\n"],
    ["취소선은 아래첨자가 아니다", "~~strikethrough~~\n"],
    ["단일 등호", "a = b\n"],
    ["떨어진 캐럿", "a ^ b\n"],
    ["HTML 형태 그대로", "<mark>**b**</mark>\n"],
    ["밑줄", "<u>**b**</u>\n"],
  ])("%s 는 바이트 그대로다", (_label, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

describe("정규화가 스스로를 망가뜨리지 않는다 (§5.1)", () => {
  it("같은 태그가 이미 구간 안에 있으면 건드리지 않는다", () => {
    // `convert-inline.ts`의 상태 플래그는 카운터가 아니라 boolean이라, 안쪽
    // `</mark>`가 바깥 것을 꺼 버린다. 정규화하면 사용자가 직접 쓴 `<mark>` 태그가
    // 지워지고 뒤쪽 ` c`가 마크를 잃었다 — 변환 결과는 전부 텍스트라
    // `spanYieldsOnlyText`로는 보이지 않는 구멍이다.
    expect(inlineShape(parse("==a <mark>b</mark> c==\n"))).toEqual([
      ["==a ", []],
      ["b", ["highlight"]],
      [" c==", []],
    ]);
    expect(inlineShape(parse("~a <sub>b</sub> c~\n"))).toEqual([
      ["~a ", []],
      ["b", ["subscript"]],
      [" c~", []],
    ]);
  });
});

describe("단축 구문 복원의 안전 조건 (§7.1)", () => {
  it("내용 끝에 구분자 문자가 붙으면 단축 구문을 쓰지 않는다", () => {
    // `==` 는 두 글자라 `includes("==")` 만 보면 `a=` 가 통과한다. 그러면 `==a===`
    // 가 되고, 되읽을 때 끝의 `=` 가 **마크 밖으로 떨어진다**. 바이트는 그대로라
    // 라운드트립 단정으로는 안 보이고 마크를 봐야 잡힌다.
    const highlighted = (text: string) =>
      schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text(text, [schema.marks.highlight.create()]),
        ]),
      ]);
    for (const text of ["a=", "=a", "a"]) {
      const md = prosemirrorToMarkdown(highlighted(text));
      expect(inlineShape(markdownToProsemirror(md, schema)), text).toEqual([
        [text, ["highlight"]],
      ]);
    }
  });

  it("변환이 지워 버리는 내용을 근거로 거절하지 않는다", () => {
    // `<br>` 같은 인식 못 하는 html 은 변환이 **삭제**한다. 그걸 거절 근거로 쓰면
    // 첫 저장은 거절하고, 두 번째 저장은 근거가 사라져 허용한다 — 저장할 때마다
    // 바이트와 마크가 움직인다. 판정을 변환 **후** 결과로 하면 두 번 다 같다.
    for (const input of [
      "==a <br> **c**==\n",
      "==a <span>b</span> **c**==\n",
      "==**b**<br>==\n",
    ]) {
      const once = roundtrip(input);
      expect(roundtrip(once), input).toBe(once);
      expect(inlineShape(parse(once)), input).toEqual(
        inlineShape(parse(roundtrip(once))),
      );
    }
  });
});

describe("모든 형태가 고정점이다 (§8.4)", () => {
  // 두 번째 저장이 첫 번째와 달라지면, 파일을 열어 두기만 해도 디스크가 흔들린다.
  it.each([
    "==**b**==\n",
    "~`c`~\n",
    "^**b**^\n",
    "==**b** and more==\n",
    "a ==x **y** z== b\n",
    "==**b**== and ==plain==\n",
    "==[l](https://example.com)==\n",
    "==plain==\n",
    "<mark>**b**</mark>\n",
  ])("%j", (input) => {
    const once = roundtrip(input);
    expect(roundtrip(once)).toBe(once);
  });
});
