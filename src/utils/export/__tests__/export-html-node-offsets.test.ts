// issue 631 — offsets in an html node's text mapped back to the source.
import { describe, expect, it } from "vitest";

import { LINE_END, valueToSource } from "../export-html-node-offsets";

describe("valueToSource", () => {
  it("maps a node's text back through container prefixes and an expanded tab", () => {
    const source = '> <img\n> src="img/a.png"\n> height="1">\n';
    const value = '<img\nsrc="img/a.png"\nheight="1">';
    const map = valueToSource(value, source, 2)!;
    expect(source.slice(map(0), map(value.length))).toBe(
      '<img\n> src="img/a.png"\n> height="1">',
    );
    const tabbed = '>\t<img src="img/a.png">\n';
    const expanded = '  <img src="img/a.png">';
    const map2 = valueToSource(expanded, tabbed, 2)!;
    expect(tabbed.slice(map2(2), map2(expanded.length))).toBe(
      '<img src="img/a.png">',
    );
  });

  it("gives up when the lines cannot be aligned", () => {
    expect(valueToSource("<img\nx>", "<img\ny>\n", 0)).toBeNull();
  });
});

describe("LINE_END", () => {
  it("keeps no position between callers: two tests of the same text both match", () => {
    // A global pattern remembers where its last match ended, so a second
    // `.test()` on the same text starts past the line break and fails —
    // and every caller that split by it would read the lines one off.
    expect(LINE_END.test("a\nb")).toBe(true);
    expect(LINE_END.test("a\nb")).toBe(true);
    expect("a\r\nb\rc\nd".split(LINE_END)).toEqual(["a", "b", "c", "d"]);
  });
});
