import type { EditorTab } from "../../stores/editor/editor";

// §285 유지 목록 — kind 판정과 kind별 독립 MRU 상한.
//
// ‼️ 상한을 kind별로 나눈 것이 이 모듈의 핵심 성질이다: PDF를 세 번째로 열어도 코드 탭은
// 밀려나면 안 된다. 전역 상한 하나였다면 그 성질이 없다.
import { describe, expect, it } from "vitest";

import {
  computeRetained,
  retainedKindForTab,
  RETENTION_CAPS,
} from "../use-retained-tabs";

const EMPTY = {
  htmlSourceTabs: new Set<string>(),
  pluginPreviewTabs: new Set<string>(),
  sourceModeTabs: new Set<string>(),
};

function tab(
  id: string,
  filePath: string,
  type?: EditorTab["type"],
): EditorTab {
  return {
    contextId: "ctx",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
    type,
  };
}

describe("retainedKindForTab", () => {
  it("classifies each surface", () => {
    expect(retainedKindForTab(tab("a", "/v/a.pdf"), EMPTY)).toBe("pdf");
    expect(retainedKindForTab(tab("b", "/v/b.py"), EMPTY)).toBe("code");
    expect(retainedKindForTab(tab("c", "/v/c.html"), EMPTY)).toBe("html");
    expect(retainedKindForTab(tab("g", "", "graph"), EMPTY)).toBe("graph");
    expect(retainedKindForTab(tab("p", "", "plugin"), EMPTY)).toBe("plugin");
  });

  it("returns null for a WYSIWYG markdown tab — the always-mounted editor owns it", () => {
    expect(retainedKindForTab(tab("m", "/v/m.md"), EMPTY)).toBeNull();
  });

  it("returns null for images and other binaries", () => {
    // ‼️ 회귀 가드: "남은 건 전부 텍스트"로 떨어뜨리면 .png가 code로 분류되어
    // SourceCodeEditor에 바이너리가 실린다. §290에서 이미지 뷰어를 제외했으므로 여기도 null.
    expect(retainedKindForTab(tab("i", "/v/i.png"), EMPTY)).toBeNull();
    expect(retainedKindForTab(tab("j", "/v/j.jpg"), EMPTY)).toBeNull();
  });

  it("moves a markdown tab into `code` when it is in source mode", () => {
    const input = { ...EMPTY, sourceModeTabs: new Set(["m"]) };
    expect(retainedKindForTab(tab("m", "/v/m.md"), input)).toBe("code");
  });

  it("moves an html tab into `code` when it is in source view", () => {
    const input = { ...EMPTY, htmlSourceTabs: new Set(["c"]) };
    expect(retainedKindForTab(tab("c", "/v/c.html"), input)).toBe("code");
  });

  it("does not retain a text file a plugin viewer is rendering", () => {
    // ‼️ SVG는 텍스트라 마지막 줄까지 흘러가 `code`가 된다. 플러그인이 프리뷰를 그리는
    // 동안에는 유지하지 않아야 두 표면이 동시에 살아 있지 않는다(§290).
    const preview = { ...EMPTY, pluginPreviewTabs: new Set(["s"]) };
    expect(retainedKindForTab(tab("s", "/v/s.svg"), preview)).toBeNull();
  });

  it("retains that same file as `code` once it switches to source view", () => {
    const source = {
      ...EMPTY,
      htmlSourceTabs: new Set(["s"]),
      pluginPreviewTabs: new Set(["s"]),
    };
    expect(retainedKindForTab(tab("s", "/v/s.svg"), source)).toBe("code");
  });
});

describe("computeRetained", () => {
  it("puts the active tab at the front (MRU)", () => {
    const tabs = [tab("p1", "/v/1.pdf"), tab("p2", "/v/2.pdf")];
    const first = computeRetained([], "p1", tabs, EMPTY);
    const second = computeRetained(first, "p2", tabs, EMPTY);
    expect(second.map((e) => e.tabId)).toEqual(["p2", "p1"]);
  });

  it("evicts the LRU entry of the SAME kind only", () => {
    // caps: pdf 2, code 3 — opening a third pdf must not touch the code entry.
    const tabs = [
      tab("p1", "/v/1.pdf"),
      tab("p2", "/v/2.pdf"),
      tab("p3", "/v/3.pdf"),
      tab("c1", "/v/1.py"),
    ];
    let r = computeRetained([], "c1", tabs, EMPTY);
    r = computeRetained(r, "p1", tabs, EMPTY);
    r = computeRetained(r, "p2", tabs, EMPTY);
    r = computeRetained(r, "p3", tabs, EMPTY);
    expect(r.filter((e) => e.kind === "pdf").map((e) => e.tabId)).toEqual([
      "p3",
      "p2",
    ]);
    expect(r.some((e) => e.tabId === "c1")).toBe(true);
  });

  it("drops entries whose tab was closed", () => {
    const open = [tab("p1", "/v/1.pdf"), tab("p2", "/v/2.pdf")];
    let r = computeRetained([], "p1", open, EMPTY);
    r = computeRetained(r, "p2", open, EMPTY);
    r = computeRetained(r, "p2", [tab("p2", "/v/2.pdf")], EMPTY);
    expect(r.map((e) => e.tabId)).toEqual(["p2"]);
  });

  it("re-kinds an entry when the tab toggles source mode", () => {
    const tabs = [tab("m", "/v/m.md")];
    const off = computeRetained([], "m", tabs, EMPTY);
    expect(off).toEqual([]);
    const on = computeRetained(off, "m", tabs, {
      ...EMPTY,
      sourceModeTabs: new Set(["m"]),
    });
    expect(on).toEqual([{ kind: "code", tabId: "m" }]);
  });

  it("declares a cap for every kind", () => {
    // A new kind added without a cap would silently retain without bound.
    expect(Object.values(RETENTION_CAPS).every((n) => n >= 1)).toBe(true);
    expect(Object.keys(RETENTION_CAPS).sort()).toEqual([
      "code",
      "graph",
      "html",
      "pdf",
      "plugin",
    ]);
  });
});

describe("html retention (regression)", () => {
  // ‼️ 상한 1이던 시절, HTML 탭 두 개를 오가면 매번 축출·재마운트되어 문서가 처음으로
  // 돌아갔다. 같은 세션의 PDF는 멀쩡했기 때문에 "HTML만 안 된다"로 보였다.
  it("keeps both html tabs alive across a round trip", () => {
    const tabs = [tab("h1", "/v/1.html"), tab("h2", "/v/2.html")];
    let r = computeRetained([], "h1", tabs, EMPTY);
    r = computeRetained(r, "h2", tabs, EMPTY);
    expect(r.map((e) => e.tabId).sort()).toEqual(["h1", "h2"]);
    r = computeRetained(r, "h1", tabs, EMPTY);
    expect(r.map((e) => e.tabId).sort()).toEqual(["h1", "h2"]);
  });

  it("still evicts the LRU html tab beyond the cap", () => {
    const tabs = [
      tab("h1", "/v/1.html"),
      tab("h2", "/v/2.html"),
      tab("h3", "/v/3.html"),
    ];
    let r = computeRetained([], "h1", tabs, EMPTY);
    r = computeRetained(r, "h2", tabs, EMPTY);
    r = computeRetained(r, "h3", tabs, EMPTY);
    expect(r.map((e) => e.tabId)).toEqual(["h3", "h2"]);
  });
});
