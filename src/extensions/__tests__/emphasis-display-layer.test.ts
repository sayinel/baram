// §368.2 / 스펙 §15.5 — 강조 렌더링은 **표시 선택**이지 문서 변경이 아니다.
//
// ‼️ 이 파일의 라운드트립 단언만으로는 공허하다. 오늘 이 다이얼은 CSS 변수만
// 내므로 어떤 값으로 돌려도 직렬화가 바뀔 수 없고, 그러면 "무엇이 이것을
// 실패시키는가" 에 답이 없다. 그래서 아래 세 describe 가 한 묶음이다 —
// 하나는 파이프라인이 살아 있음을, 하나는 다이얼의 출력 형태를, 하나는
// 마크 확장의 의존 경계를 고정한다. 셋째가 이 파일의 진짜 관문이다.
import { Schema } from "@tiptap/pm/model";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DIALS } from "../../appearance/dials";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// 스키마는 `src/pipeline/__tests__/roundtrip-inline-marks.test.ts` 의 모양을
// 전사한다 — 새로 발명하면 그 파일과 갈라져 둘 중 하나가 낡는다.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    strike: {},
    highlight: {},
    subscript: {},
    superscript: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
  },
});

const EMPHASIS = DIALS.find((d) => d.id === "editorEmphasisStyle");
const EMPHASIS_OPTIONS: readonly string[] =
  EMPHASIS && "options" in EMPHASIS ? EMPHASIS.options : [];

describe("라운드트립 기계장치가 살아 있다 (긍정)", () => {
  // 무엇이 이것을 실패시키는가: md-to-pm 이나 pm-to-md 가 문법을 깨거나,
  // 파이프라인이 이 스키마의 italic 마크를 더 이상 못 찾으면 실패한다.
  it("`*강조*` 가 바이트 동일하게 돈다", () => {
    const md = "평범한 글에 *강조* 가 섞인 문장.\n";
    const doc = markdownToProsemirror(md, schema);
    expect(prosemirrorToMarkdown(doc)).toBe(md);
  });

  // 무엇이 이것을 실패시키는가: 위 테스트만으로는 "다 텍스트로 뭉개져도
  // 원문과 같아 보이는" 우연한 통과를 배제하지 못한다 — 마크가 실제로
  // 붙었는지 직접 확인한다.
  it("마크가 실제로 붙는다 — 텍스트만 통과시키는 파이프라인이 아니다", () => {
    const doc = markdownToProsemirror("*강조*\n", schema);
    const marks = doc.firstChild?.firstChild?.marks.map((m) => m.type.name);
    expect(marks).toContain("italic");
  });
});

describe("모든 강조 값에서 직렬화가 같다 (검증 5)", () => {
  // 무엇이 이것을 실패시키는가: 오늘은 아무것도 — `toVars` 가 CSS 커스텀
  // 프로퍼티만 내므로 직렬화 경로에 닿을 길이 없다. 미래에 다이얼 값이
  // 문서 모델이나 파이프라인에 분기를 만들면 여기가 갈라진다. 이 describe
  // 혼자서는 공허하고, 그래서 위 긍정 단언과 아래 경계 스캔이 짝을 이룬다.
  it.each(EMPHASIS_OPTIONS)("값 %s", (option) => {
    // 다이얼을 그 값으로 두는 것은 CSS 변수를 쓰는 일뿐이므로, 여기서는
    // 그 변수를 실제로 만들어 본 뒤 직렬화가 영향받지 않음을 확인한다.
    const vars = EMPHASIS?.toVars(option) ?? {};
    for (const [k, v] of Object.entries(vars)) {
      document.documentElement.style.setProperty(k, v);
    }
    const md = "평범한 글에 *강조* 가 섞인 문장.\n";
    expect(prosemirrorToMarkdown(markdownToProsemirror(md, schema))).toBe(md);
  });
});

describe("강조 다이얼은 CSS 커스텀 프로퍼티만 낸다 (구조)", () => {
  // 무엇이 이것을 실패시키는가: `toVars` 가 `--` 로 시작하지 않는 키(예:
  // 노드 속성 이름, data-* 어트리뷰트 키)를 내면 실패한다.
  it("모든 값의 모든 키가 `--` 로 시작한다", () => {
    for (const option of EMPHASIS_OPTIONS) {
      for (const key of Object.keys(EMPHASIS?.toVars(option) ?? {})) {
        expect(key.startsWith("--")).toBe(true);
      }
    }
  });

  it("`italic` 은 아무것도 내지 않고, 나머지는 font-style 을 함께 낸다", () => {
    // 비공허성: 위 단언은 toVars 가 항상 `{}` 여도 통과한다. 이것이 그 구현을 배제한다.
    // 무엇이 이것을 실패시키는가: `italic` 값이 변수를 내기 시작하거나,
    // `color`/`weight` 가 `--editor-emphasis-font-style: normal` 을 빠뜨리면
    // (기울임 위에 색·굵기가 겹쳐 얹히는 회귀, dials.ts 주석의 그 사례) 실패한다.
    expect(EMPHASIS?.toVars("italic")).toEqual({});
    for (const option of ["color", "weight"]) {
      expect(EMPHASIS?.toVars(option)).toHaveProperty(
        "--editor-emphasis-font-style",
        "normal",
      );
    }
  });
});

describe("italic 마크는 외관을 알지 못한다 (경계)", () => {
  // ‼️ 리터럴 경로 스캔이다. CLAUDE.md 가 경고한 대로, 심볼을 옮기면 컴파일은
  // 통과해도 검증이 조용히 죽는다 — 그래서 파일이 존재하고 renderHTML 을 담고
  // 있다는 것을 **먼저** 단언한다. 그 단언이 스캔의 비공허성 보증이다.
  const ITALIC = resolve(__dirname, "../marks/italic.ts");
  const source = readFileSync(ITALIC, "utf8");

  // 무엇이 이것을 실패시키는가: `italic.ts` 가 옮겨지거나 이름이 바뀌어
  // 이 경로에 다른(또는 없는) 파일이 있으면, 혹은 renderHTML 이 다른
  // 태그로 바뀌면 실패한다 — 아래 경계 단언의 비공허성을 보장한다.
  it("스캔이 옳은 파일을 읽었다", () => {
    expect(source).toContain("renderHTML");
    expect(source).toContain('"em"');
  });

  // 무엇이 이것을 실패시키는가: 미래의 구현이 `italic.ts` 에서 다이얼 값을
  // 읽으려 `appearance/dials` 나 settings 스토어를 import 하면 실패한다.
  // Step 2 프로브(보고서 참조)로 실제로 빨개짐을 확인했다.
  it("appearance·settings store 를 import 하지 않는다", () => {
    expect(source).not.toMatch(/from\s+["'][^"']*appearance/u);
    expect(source).not.toMatch(/useSettingsStore/u);
  });
});
