import { describe, expect, it } from "vitest";

import { resolveDials } from "../merge";

describe("resolveDials", () => {
  it("falls back to the dial's default when no layer speaks", () => {
    const r = resolveDials({}, {});
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
    expect(r.editorPadding).toEqual({ origin: "default", value: 4 });
  });

  it("lets the theme layer win over the default", () => {
    const r = resolveDials({ editorMaxWidth: 1200 }, {});
    expect(r.editorMaxWidth).toEqual({ origin: "theme", value: 1200 });
  });

  it("lets the user layer win over the theme", () => {
    const r = resolveDials({ editorMaxWidth: 1200 }, { editorMaxWidth: 640 });
    expect(r.editorMaxWidth).toEqual({ origin: "user", value: 640 });
  });

  it("keeps the user's pin even when it equals the default", () => {
    // 무엇이 이것을 실패시키는가: "기본값과 같으면 사용자 층을 무시" 하는 최적화를
    // 넣으면, 테마가 1200 을 주는 동안 사용자가 800(기본)으로 고정한 의도가 사라져
    // 테마 값이 되살아난다. §366 의 "기본값으로 되돌리기" 가 정확히 이 경우다.
    const r = resolveDials({ editorMaxWidth: 1200 }, { editorMaxWidth: 800 });
    expect(r.editorMaxWidth).toEqual({ origin: "user", value: 800 });
  });

  it("skips a layer whose value fails the dial's parse", () => {
    const r = resolveDials(
      { editorMaxWidth: -5 } as never,
      { editorMaxWidth: Number.NaN } as never,
    );
    expect(r.editorMaxWidth).toEqual({ origin: "default", value: 800 });
  });

  it("ignores keys that are not dials", () => {
    // 저장분·매니페스트는 외부 입력이다. 결과는 DIALS 를 순회해 만들어지므로
    // 낯선 키는 결과에 자리가 없다.
    const r = resolveDials({ display: "none" } as never, {});
    expect(Object.keys(r).sort()).toEqual(["editorMaxWidth", "editorPadding"]);
  });
});
