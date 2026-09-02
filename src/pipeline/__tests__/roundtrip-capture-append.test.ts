import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { appendCapture } from "../../utils/zettelkasten/capture-append";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// 프로덕션 스키마 그대로. 손으로 짠 최소 스키마는 `blockId`를 빠뜨릴 수 있고,
// 그러면 이 테스트가 지키려는 바로 그 형태를 검사하지 못한다.
const schema = getSchema(createBaramExtensions());

const roundTrip = (md: string) =>
  prosemirrorToMarkdown(markdownToProsemirror(md, schema));

describe("§321 capture append round trip", () => {
  const preamble = [
    `---`,
    `title: 영감노트`,
    `---`,
    ``,
    `# 영감노트`,
    ``,
    `서문.`,
    ``,
  ].join("\n");

  // ‼️ 이 단정이 §321의 "블록 ID는 헤딩 끝"이라는 형태를 지킨다. `^id`를 자기 줄에
  // 두면 소프트 브레이크로 파싱돼 재직렬화 때 한 줄로 합쳐지고 이 테스트가 실패한다.
  it("survives MD → PM → MD unchanged", () => {
    const out = appendCapture(
      preamble,
      {
        body: "여러 문단.\n\n둘째 문단에 **강조**와 [링크](https://example.com)도 있다.",
        heading: "2026-09-02 14:15",
        source: "제목 https://example.com/x",
      },
      "m2609021415",
    );
    expect(roundTrip(out).trim()).toBe(out.trim());
  });

  // ‼️ 블록 ID가 라운드트립 뒤에도 **살아 있는** 것. 위 테스트는 "문자열이 같다"만
  // 보므로, `^m…`이 양쪽에서 똑같이 사라져도 초록이 된다. 그러면 §30b 참조가 이 항목을
  // 가리킬 수 없는데 테스트는 아무 말도 하지 않는다.
  it("keeps the block id on the entry heading", () => {
    const out = appendCapture(
      preamble,
      { body: "본문", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(roundTrip(out)).toContain("^m2609021415");
    const doc = markdownToProsemirror(out, schema);
    let found: null | string = null;
    doc.descendants((n) => {
      if (n.type.name === "heading" && n.attrs.blockId) {
        found = n.attrs.blockId as string;
      }
      return true;
    });
    expect(found).toBe("m2609021415");
  });

  // 두 항목이 쌓인 뒤에도 그대로인 것 — 삽입이 앞 항목의 형태를 건드리지 않는다.
  it("survives a round trip after two appends", () => {
    const one = appendCapture(
      preamble,
      { body: "오전", heading: "2026-09-02 10:30" },
      "m2609021030",
    );
    const two = appendCapture(
      one,
      { body: "오후", heading: "2026-09-02 14:15" },
      "m2609021415",
    );
    expect(roundTrip(two).trim()).toBe(two.trim());
  });
});
