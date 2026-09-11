// §349 — 문서 표면에만 두 변수를 덮는다.
//
// 왜 :root 가 아닌가: var(--font-family-mono) 소비자가 문서 쪽보다 크롬 쪽에 더
// 많다. :root 에 덮으면 사용자가 코드 서체를 바꿀 때 파일 트리 경로·git 해시·
// 상태바가 함께 변한다. 표면에만 덮으면 CSS 변수 상속으로 문서 쪽이 배선 없이
// 따라온다. 그 비대칭의 실측은 `styles/__tests__/font-variable-scope.test.ts` 가
// 들고 있다 — 숫자를 여기 베껴 두면 낡는다.
//
// ‼️ 이 파일의 첫 테스트는 "표면을 하나 더 만들고 단정을 안 늘리는" 실패를 잡는다.
// 열거를 손으로 센 가드는 다음 멤버를 놓치기 때문이다.
//
// ‼️ 이 파일이 증명하지 못하는 것: 여기의 단정은 전부 **커스텀 속성의 문자열
// 값**이다. 커스텀 속성은 파싱 시점에 거의 모든 토큰 열을 받아들이고 검증을
// 치환 시점으로 미루며, jsdom 은 var() 치환을 아예 구현하지 않는다. 그래서
// 통과는 "올바른 문자열을 썼다"까지이고 "서체가 렌더된다"가 아니다 — 후자는
// 스펙이 사람 손 검증으로 들고 있다.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { bundledFont } from "../../font/bundled-fonts";
import {
  applyFontVariables,
  BASE_EDITOR_STACK,
  BASE_MONO_STACK,
  DOCUMENT_FONT_SURFACES,
} from "../font-surfaces";

/** 표면마다 이 파일이 실제로 단정하는 것 — 아래 소진 테스트가 이 키를 센다. */
const ASSERTED: Record<string, "both" | "mono"> = {
  "capture-editor": "both",
  "export-article": "both",
  "image-fullscreen": "both",
  "math-preview-popover": "both",
  "mermaid-fullscreen": "both",
  "source-mode": "mono",
  "svg-fullscreen": "both",
  wysiwyg: "both",
};

/**
 * 스택을 비교 가능한 모양으로 — 패밀리마다 인용부호를 벗기고 소문자화한다.
 *
 * 생성된 CSS 는 다단어 패밀리명을 따옴표로 감싸고 단일 단어는 소문자화하므로
 * (Style Dictionary CSS formatter) 문자열 그대로는 비교되지 않는다.
 */
const normalizeStack = (stack: string): string =>
  stack
    .split(",")
    .map((f) =>
      f
        .trim()
        .replace(/\s+/gu, " ")
        .replace(/^["']|["']$/gu, "")
        .toLowerCase(),
    )
    .filter((f) => f !== "")
    .join(", ");

/** `src/styles/generated/primitives.css` 가 그 토큰에 실제로 쓴 값. */
const tokenStack = (name: string): string => {
  const css = readFileSync(
    path.join(process.cwd(), "src/styles/generated/primitives.css"),
    "utf8",
  );
  const match = new RegExp(`--font-family-${name}:\\s*([^;]+);`, "u").exec(css);
  if (!match) throw new Error(`no --font-family-${name} in primitives.css`);
  return match[1];
};

describe("§349 document font surfaces", () => {
  // 소진 산술: 상수에 표면을 더하면 이 테스트가 먼저 실패한다.
  it("asserts every enumerated surface", () => {
    const enumerated = DOCUMENT_FONT_SURFACES.map((s) => s.id).sort();
    expect(Object.keys(ASSERTED).sort()).toEqual(enumerated);
    expect(enumerated.length).toBe(8);
  });

  it("records which variables each surface takes", () => {
    for (const surface of DOCUMENT_FONT_SURFACES) {
      expect(surface.which, `surface ${surface.id}`).toBe(ASSERTED[surface.id]);
    }
  });

  it("sets both variables on a both-surface, user family first", () => {
    const el = document.createElement("div");
    applyFontVariables(el, {
      bodyFont: "Noto Sans KR",
      codeFont: "D2Coding",
      which: "both",
    });
    expect(el.style.getPropertyValue("--font-family-editor")).toBe(
      `"Noto Sans KR", ${BASE_EDITOR_STACK}`,
    );
    expect(el.style.getPropertyValue("--font-family-mono")).toBe(
      `"D2Coding", ${BASE_MONO_STACK}`,
    );
  });

  // 소스 모드는 원문을 고정폭으로 보여준다 — 본문 서체를 덮으면 안 된다.
  it("sets only the mono variable on a mono-surface", () => {
    const el = document.createElement("div");
    applyFontVariables(el, {
      bodyFont: "Noto Sans KR",
      codeFont: "D2Coding",
      which: "mono",
    });
    expect(el.style.getPropertyValue("--font-family-mono")).toBe(
      `"D2Coding", ${BASE_MONO_STACK}`,
    );
    expect(el.style.getPropertyValue("--font-family-editor")).toBe("");
  });

  // 빈 설정은 "토큰 스택을 그대로"라는 뜻이므로 변수를 아예 두지 않는다.
  it("removes the property when the setting is empty", () => {
    const el = document.createElement("div");
    applyFontVariables(el, {
      bodyFont: "Inter",
      codeFont: "D2Coding",
      which: "both",
    });
    applyFontVariables(el, { bodyFont: "", codeFont: "", which: "both" });
    expect(el.style.getPropertyValue("--font-family-editor")).toBe("");
    expect(el.style.getPropertyValue("--font-family-mono")).toBe("");
  });

  it("routes a digit-leading name through quoteFamily", () => {
    const el = document.createElement("div");
    applyFontVariables(el, {
      bodyFont: "Source Sans 3",
      codeFont: "",
      which: "both",
    });
    expect(el.style.getPropertyValue("--font-family-editor")).toBe(
      `"Source Sans 3", ${BASE_EDITOR_STACK}`,
    );
  });

  // 이름은 §347 단일 출처에서 끌어온다 — `bundledFont` 가 이제 역할로 서체를
  // 꺼내는 유일한 방법이므로, 여기 `find(role)` 을 다시 쓰지 않는다.
  it("keeps the bundled families at the head of each base stack", () => {
    expect(
      BASE_EDITOR_STACK.startsWith(`"${bundledFont("body").family}"`),
    ).toBe(true);
    expect(BASE_MONO_STACK.startsWith(`"${bundledFont("code").family}"`)).toBe(
      true,
    );
  });

  // §349 리뷰 Important 2 — :root 회귀를 **철자로 우회할 수 없는** 자리에서 막는다.
  //
  // 원래 가드는 `document.documentElement.style.setProperty("--font-family-…")`
  // 라는 한 가지 철자를 소스에서 grep 했다. 그런데 이 함수는 `HTMLElement` 를
  // 받으므로 `applyFontVariables(document.documentElement, …)` 한 줄이면 같은
  // 누수를 만들면서 그 정규식에는 걸리지 않는다 — 그리고 그 한 줄이야말로
  // 스타일이 안 먹는 표면을 발견한 사람이 제일 먼저 시도하는 것이다.
  // 함수 안에서 막으면 아직 쓰이지 않은 호출부(Task 7 포함)까지 덮는다.
  it.each([
    ["documentElement", () => document.documentElement],
    ["body", () => document.body],
  ])("refuses to write the variables to %s", (_name, target) => {
    expect(() =>
      applyFontVariables(target(), {
        bodyFont: "Inter",
        codeFont: "D2Coding",
        which: "both",
      }),
    ).toThrow(/§349/u);
  });

  // 거부는 아무것도 쓰지 않은 채여야 한다 — 던지기 전에 한쪽을 이미 설정했다면
  // 크롬은 이미 오염됐고 예외는 사후 통보일 뿐이다.
  it("leaves the rejected root untouched", () => {
    const root = document.documentElement;
    expect(() =>
      applyFontVariables(root, {
        bodyFont: "Inter",
        codeFont: "D2Coding",
        which: "both",
      }),
    ).toThrow();
    expect(root.style.getPropertyValue("--font-family-editor")).toBe("");
    expect(root.style.getPropertyValue("--font-family-mono")).toBe("");
  });

  // 두 곳이 같은 폴백 스택을 적는다 — 이 TS 상수와 생성된 토큰. 갈라지면
  // 사용자 설정이 있는 표면과 없는 표면이 서로 다른 서체로 렌더되고, 그 차이는
  // 아무 게이트도 못 본다. 그래서 여기서 파생 비교로 묶는다.
  it("agrees with the generated token stacks after normalization", () => {
    expect(normalizeStack(BASE_EDITOR_STACK)).toBe(
      normalizeStack(tokenStack("editor")),
    );
    expect(normalizeStack(BASE_MONO_STACK)).toBe(
      normalizeStack(tokenStack("mono")),
    );
  });
});

// ‼️ `where` 는 사람에게 배선 위치를 알려 주는 유일한 단서이고, 이 브랜치에서
// 그것이 세 번 낡았다 — 한 번은 포털이 옮겨 간 뒤에도 옛 파일을 댔다(final
// review T5-1). 파일 이름이 줄 번호보다 나은 이유가 바로 이것이다: 확인할 수
// 있다. 그래서 확인한다.
describe("§349 the `where` hints name files that exist", () => {
  const named = DOCUMENT_FONT_SURFACES.flatMap((s) => [
    ...s.where.matchAll(/[\w./-]+\.tsx?/gu),
  ]).map((m) => m[0]);

  it("found file names in the hints, so the check below is not vacuous", () => {
    // 표면 여덟 개가 각자 하나 이상을 댄다.
    expect(named.length).toBeGreaterThanOrEqual(DOCUMENT_FONT_SURFACES.length);
  });

  it.each([...new Set(named)])("%s", (name) => {
    // 경로 조각이 들었으면 그 조각으로 끝나는 파일을, 아니면 basename 으로 찾는다.
    const matches = sourceFiles().filter((file) =>
      name.includes("/")
        ? file.endsWith(path.posix.normalize(name))
        : path.posix.basename(file) === name,
    );
    expect(matches, `no file under src/ matches "${name}"`).not.toHaveLength(0);
  });
});

/** src/ 아래 모든 .ts/.tsx 의 posix 경로. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/u.test(entry.name)) out.push(full);
    }
  };
  walk("src");
  return out;
}
