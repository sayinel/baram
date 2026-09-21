import { beforeEach, describe, expect, it } from "vitest";

import { applyDialVars, clearDialVars } from "../apply";
import { resolveDials } from "../merge";

function root(): HTMLElement {
  const el = document.createElement("html");
  document.body.append(el);
  return el;
}

describe("applyDialVars", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("writes NOTHING when every dial is at its default", () => {
    // 무엇이 이것을 실패시키는가: 기본값까지 인라인으로 쓰면 `system` 테마에서
    // `prefers-color-scheme` 미디어 쿼리를 눌러 이겨 OS 추종이 죽는다.
    // §364.2 의 희소성 불변식이 바로 이 단언이다.
    const el = root();
    applyDialVars(el, resolveDials({}, {}));
    expect(el.getAttribute("style")).toBeNull();
  });

  it("writes only the dials a layer actually spoke for", () => {
    const el = root();
    applyDialVars(el, resolveDials({ editorPadding: 2 }, {}));
    expect(el.style.getPropertyValue("--editor-padding")).toBe("2rem");
    expect(el.style.getPropertyValue("--editor-max-width")).toBe("");
  });

  it("removes a variable when the dial falls back to default", () => {
    const el = root();
    applyDialVars(el, resolveDials({ editorPadding: 2 }, {}));
    applyDialVars(el, resolveDials({}, {}));
    expect(el.style.getPropertyValue("--editor-padding")).toBe("");
  });

  it("emits no variable for an unbounded width, even from a non-default layer", () => {
    const el = root();
    applyDialVars(el, resolveDials({}, { editorMaxWidth: 0 }));
    expect(el.style.getPropertyValue("--editor-max-width")).toBe("");
  });

  it("never writes the literal string 'undefined'", () => {
    const el = root();
    applyDialVars(el, resolveDials({}, { editorMaxWidth: 640 }));
    expect(el.getAttribute("style") ?? "").not.toContain("undefined");
  });
});

describe("clearDialVars", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("removes every variable applyDialVars can set", () => {
    // 무엇이 이것을 실패시키는가: apply 와 clear 가 다른 목록을 돌면, 다이얼을
    // 되돌려도 변수가 남아 cascade 로 돌아가지 못한다.
    const el = root();
    applyDialVars(
      el,
      resolveDials({ editorMaxWidth: 640, editorPadding: 2 }, {}),
    );
    expect(el.getAttribute("style")).not.toBeNull();
    clearDialVars(el);
    expect(el.getAttribute("style") ?? "").toBe("");
  });
});
