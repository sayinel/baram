// issue 549 — one `{ __html }` object per distinct string. React 19 compares
// the dangerouslySetInnerHTML prop by identity (react-dom updateProperties:
// `propKey !== lastProp`, then setProp assigns innerHTML unconditionally), so
// an inline literal re-seeds the element on every render. The hook is what
// makes the diagram views hand React the same object while the string holds.
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useInnerHtml } from "../use-inner-html";

describe("useInnerHtml (issue 549)", () => {
  it("returns the same object across re-renders while the string holds", () => {
    const { rerender, result } = renderHook(({ html }) => useInnerHtml(html), {
      initialProps: { html: "<svg/>" },
    });
    const first = result.current;
    rerender({ html: "<svg/>" });
    rerender({ html: "<svg/>" });
    expect(result.current).toBe(first);
    expect(first).toEqual({ __html: "<svg/>" });
  });

  it("returns a new object carrying the new string when it changes", () => {
    const { rerender, result } = renderHook(({ html }) => useInnerHtml(html), {
      initialProps: { html: "<svg/>" },
    });
    const first = result.current;
    rerender({ html: "<svg><rect/></svg>" });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual({ __html: "<svg><rect/></svg>" });
  });

  it("wraps the empty string too, so a site can branch on __html", () => {
    const { result } = renderHook(() => useInnerHtml(""));
    expect(result.current).toEqual({ __html: "" });
  });
});
