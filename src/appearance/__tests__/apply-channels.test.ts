// §365 채널이 셋이 되었다(스펙 0060 D3). `color` 는 테마 이펙트가, `layout` 은 `applyDialVars`
// 가 쓰고, `editor` 는 아무도 `<html>` 에 쓰지 않는다 — 소비자가 병합값을 읽는다.
import type { DialContext, DialDef } from "../dials";

import { afterEach, describe, expect, it, vi } from "vitest";

import { applyDialVars, colorDialVars } from "../apply";
import { DIALS } from "../dials";
import { resolveDials } from "../merge";

const CTX: DialContext = { mode: "light", seeds: {} };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("editor 채널", () => {
  // 무엇이 이것을 실패시키는가: `colorDialVars` 의 술어가 `=== "layout"` 으로 돌아가면 editor
  // 다이얼이 색 순회에 들어가 `toVars` 가 불린다. 오늘은 그 결과가 빈 맵이라 출력이 같으므로
  // 출력이 아니라 **호출**을 본다.
  it("colorDialVars 는 editor 다이얼의 toVars 를 부르지 않는다", () => {
    const dial = DIALS.find((d) => d.id === "editorFontSize");
    if (dial === undefined) throw new Error("editorFontSize missing");
    const spy = vi.spyOn(dial as { toVars: DialDef["toVars"] }, "toVars");
    colorDialVars(resolveDials({}, { editorFontSize: 18 }), CTX);
    expect(spy).not.toHaveBeenCalled();
  });

  it("applyDialVars 는 editor 다이얼 때문에 아무것도 쓰지 않는다", () => {
    const root = document.createElement("div");
    applyDialVars(
      root,
      resolveDials(
        {},
        { editorFontFamily: "Inter", editorFontSize: 18, editorLineHeight: 2 },
      ),
      CTX,
    );
    expect(root.getAttribute("style") ?? "").toBe("");
  });
});
