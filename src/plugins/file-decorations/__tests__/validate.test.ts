// §395 spec 0074 D4 · D5 · D6 · D7 · D14 · §6 · §7 "검증 표" — the rules both tiers judge a file tree call
// by. Each refusal has a passing neighbour; what each row catches is in its title or doc.
import { describe, expect, it } from "vitest";

import {
  ICON_BURST,
  MAX_DECORATION_PATH_CHARS,
  MAX_DECORATION_UPDATES,
  MAX_FILE_ICON_SVG_BYTES,
  MAX_FILE_ICONS,
} from "../limits";
import {
  cleanDecoration,
  COLOR_MESSAGE,
  CONTEXT_NOT_STRING_MESSAGE,
  DECORATION_NOT_OBJECT_MESSAGE,
  fileTreeCapabilityMessage,
  ICON_NAME_MESSAGE,
  ICON_SHAPE_MESSAGE,
  ICON_SVG_NAME_MESSAGE,
  iconCallProblem,
  PATH_NOT_ABSOLUTE_MESSAGE,
  PATH_TOO_LONG_MESSAGE,
  prepareUpdates,
  RELATIVE_PATH_MESSAGE,
  relativeLocate,
  SVG_TOO_LARGE_MESSAGE,
  TOO_MANY_UPDATES_MESSAGE,
  TOOLTIP_NOT_STRING_MESSAGE,
  trustedLocate,
  UPDATE_NOT_OBJECT_MESSAGE,
  UPDATES_NOT_ARRAY_MESSAGE,
} from "../validate";

/** 👨‍👩‍👧 — five code points, eight UTF-16 units, one grapheme. Escaped: no invisible characters in source. */
const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";

describe("cleanDecoration — badge (D4 · D14)", () => {
  it("keeps one or two graphemes and refuses three", () => {
    expect(cleanDecoration({ badge: "ab" })).toEqual({ badge: "ab" });
    expect(cleanDecoration({ badge: "abc" })).toBe(
      "decoration.badge must be 1–2 characters",
    );
  });

  /** What fails this: counting code points or UTF-16 units instead of graphemes. */
  it("counts a ZWJ family as one grapheme", () => {
    expect(cleanDecoration({ badge: FAMILY })).toEqual({ badge: FAMILY });
  });

  /** What fails this: no blank rule — a lone joiner survives `sanitizePluginText` and draws nothing. */
  it("refuses a badge of default-ignorable code points only", () => {
    expect(cleanDecoration({ badge: "\u200D" })).toBe(
      "decoration.badge draws nothing",
    );
    expect(cleanDecoration({ badge: "\uFE0F" })).toBe(
      "decoration.badge draws nothing",
    );
  });

  /** One grapheme either way, so only the UTF-16 bound decides: 16 units pass, 17 do not. */
  it("refuses more than 16 UTF-16 units", () => {
    expect(cleanDecoration({ badge: `e${"\u0301".repeat(15)}` })).toEqual({
      badge: `e${"\u0301".repeat(15)}`,
    });
    expect(cleanDecoration({ badge: `e${"\u0301".repeat(16)}` })).toBe(
      "decoration.badge is longer than 16 UTF-16 units",
    );
  });

  it("refuses a badge that is not a string", () => {
    expect(cleanDecoration({ badge: 3 })).toBe(
      "decoration.badge must be a string",
    );
  });
});

describe("cleanDecoration — color (D5)", () => {
  it.each(["red", "accent", "#A1b2C3"])("keeps %s", (color) => {
    expect(cleanDecoration({ color })).toEqual({ color: color.toLowerCase() });
  });

  /** What fails this: case-insensitive names, `#rgb`, CSS functions, or a value that carries a
   *  second declaration into a style. */
  it.each(["Red", "#abc", "rgb(0,0,0)", "var(--x)", "red;x:y", "constructor"])(
    "refuses %s",
    (color) => {
      expect(cleanDecoration({ color })).toBe(COLOR_MESSAGE);
    },
  );
});

describe("cleanDecoration — icon (D4 · D6)", () => {
  it("keeps one glyph and refuses two", () => {
    expect(cleanDecoration({ icon: { glyph: "★" } })).toEqual({
      icon: { glyph: "★" },
    });
    expect(cleanDecoration({ icon: { glyph: "ab" } })).toBe(
      "decoration.icon.glyph must be one character",
    );
  });

  it("keeps an icon name and refuses a name outside the charset", () => {
    expect(cleanDecoration({ icon: { svg: "star_1-x" } })).toEqual({
      icon: { svg: "star_1-x" },
    });
    expect(cleanDecoration({ icon: { svg: "star.svg" } })).toBe(
      ICON_SVG_NAME_MESSAGE,
    );
  });

  it("refuses both kinds at once, neither, and a non-object", () => {
    expect(cleanDecoration({ icon: { glyph: "★", svg: "s" } })).toBe(
      ICON_SHAPE_MESSAGE,
    );
    expect(cleanDecoration({ icon: {} })).toBe(ICON_SHAPE_MESSAGE);
    expect(cleanDecoration({ icon: "★" })).toBe(ICON_SHAPE_MESSAGE);
  });
});

describe("cleanDecoration — tooltip and the whole (D4 · D14 · P29)", () => {
  it("puts a tooltip on one line and cuts it at 120", () => {
    expect(cleanDecoration({ tooltip: "a\nb" })).toEqual({ tooltip: "a b" });
    const long = cleanDecoration({ tooltip: "x".repeat(200) });
    expect(typeof long === "object" && long?.tooltip).toBe(
      `${"x".repeat(119)}\u2026`,
    );
    expect(cleanDecoration({ tooltip: 1 })).toBe(TOOLTIP_NOT_STRING_MESSAGE);
  });

  /** D4 — `{}` is `null`; so is a decoration whose only field cleans to nothing. */
  it("reads an empty decoration as null, and leaves unknown fields behind", () => {
    expect(cleanDecoration({})).toBeNull();
    expect(cleanDecoration({ tooltip: "\n" })).toBeNull();
    expect(cleanDecoration(null)).toBeNull();
    expect(cleanDecoration({ badge: "1", weight: "bold" })).toEqual({
      badge: "1",
    });
  });

  it("refuses a decoration that is not an object or null", () => {
    expect(cleanDecoration(undefined)).toBe(DECORATION_NOT_OBJECT_MESSAGE);
    expect(cleanDecoration([])).toBe(DECORATION_NOT_OBJECT_MESSAGE);
  });

  /** §6 — the sentence names the field, never the text the plugin sent. */
  it("never repeats the plugin's text", () => {
    const refused = cleanDecoration({ badge: "<script>x" });
    expect(typeof refused).toBe("string");
    expect(refused).not.toContain("<script>");
  });
});

describe("prepareUpdates — the list (D14)", () => {
  const one = { decoration: { badge: "1" }, path: "/v/a.md" };

  it("takes 1,000 updates and refuses 1,001", () => {
    const ok = prepareUpdates(
      Array.from({ length: MAX_DECORATION_UPDATES }, () => one),
      trustedLocate,
    );
    expect(Array.isArray(ok) && ok.length).toBe(MAX_DECORATION_UPDATES);
    expect(
      prepareUpdates(
        Array.from({ length: MAX_DECORATION_UPDATES + 1 }, () => one),
        trustedLocate,
      ),
    ).toBe(TOO_MANY_UPDATES_MESSAGE);
  });

  /** What fails this: a list judged item by item and applied in part — the first bad item must
   *  refuse the call, which `prepareUpdates` reports as one sentence instead of a partial list. */
  it("refuses the whole list on its first bad item", () => {
    expect(
      prepareUpdates(
        [one, { decoration: { badge: "abc" }, path: "/v/b.md" }],
        trustedLocate,
      ),
    ).toBe("decoration.badge must be 1–2 characters");
  });

  it("refuses a non-list, a non-object item and a missing decoration", () => {
    expect(prepareUpdates({}, trustedLocate)).toBe(UPDATES_NOT_ARRAY_MESSAGE);
    expect(prepareUpdates([1], trustedLocate)).toBe(UPDATE_NOT_OBJECT_MESSAGE);
    expect(prepareUpdates([{ path: "/v/a.md" }], trustedLocate)).toBe(
      DECORATION_NOT_OBJECT_MESSAGE,
    );
  });
});

describe("paths (D7 · D14)", () => {
  it("takes trusted absolute paths up to 4,096 units", () => {
    const at = `/${"a".repeat(MAX_DECORATION_PATH_CHARS - 1)}`;
    expect(trustedLocate({ path: at })).toEqual({ absolute: at });
    expect(trustedLocate({ path: `${at}b` })).toBe(PATH_TOO_LONG_MESSAGE);
    expect(trustedLocate({ path: "C:\\v\\a.md" })).toEqual({
      absolute: "C:\\v\\a.md",
    });
    expect(trustedLocate({ path: "a.md" })).toBe(PATH_NOT_ABSOLUTE_MESSAGE);
  });

  it.each(["a/b.md", "", "notes/2026/x.md"])(
    "takes the sandboxed relative path %j",
    (path) => {
      expect(relativeLocate({ path })).toEqual({ path });
    },
  );

  /** What fails this: accepting anything `locateInContext` never emits — a leading "/", an empty,
   *  "." or ".." name, or a backslash. */
  it.each(["/a.md", "a/../b.md", "a\\b.md", "a//b.md", "./a.md", "a/"])(
    "refuses the sandboxed path %j",
    (path) => {
      expect(relativeLocate({ path })).toBe(RELATIVE_PATH_MESSAGE);
    },
  );

  it("keeps a context string and refuses a context of another type", () => {
    expect(relativeLocate({ context: "ctx-1", path: "a.md" })).toEqual({
      context: "ctx-1",
      path: "a.md",
    });
    expect(relativeLocate({ context: 1, path: "a.md" })).toBe(
      CONTEXT_NOT_STRING_MESSAGE,
    );
    expect(
      relativeLocate({ path: "a".repeat(MAX_DECORATION_PATH_CHARS + 1) }),
    ).toBe(PATH_TOO_LONG_MESSAGE);
  });
});

describe("iconCallProblem (D6)", () => {
  it("takes a name of 1–64 from the charset", () => {
    expect(iconCallProblem("star_1-x", "<svg/>")).toBeNull();
    expect(iconCallProblem("a".repeat(64), "<svg/>")).toBeNull();
    expect(iconCallProblem("a".repeat(65), "<svg/>")).toBe(ICON_NAME_MESSAGE);
    expect(iconCallProblem("", "<svg/>")).toBe(ICON_NAME_MESSAGE);
    expect(iconCallProblem("a.b", "<svg/>")).toBe(ICON_NAME_MESSAGE);
  });

  /** UTF-8, not UTF-16: 2,731 Hangul syllables are 2,731 units but 8,193 bytes. What fails this:
   *  measuring `svg.length`. */
  it("takes 8,192 bytes of UTF-8 and refuses 8,193", () => {
    expect(
      iconCallProblem("s", "x".repeat(MAX_FILE_ICON_SVG_BYTES)),
    ).toBeNull();
    expect(iconCallProblem("s", "x".repeat(MAX_FILE_ICON_SVG_BYTES + 1))).toBe(
      SVG_TOO_LARGE_MESSAGE,
    );
    expect(iconCallProblem("s", "가".repeat(2731))).toBe(SVG_TOO_LARGE_MESSAGE);
  });

  it("matches the icon bucket to the icon cap (D14: a pack defines every icon at once)", () => {
    expect(ICON_BURST).toBe(MAX_FILE_ICONS);
  });
});

describe("fileTreeCapabilityMessage (§6 · P24)", () => {
  /** The trusted `require("filetree", method)` in `createUIAPI` builds this exact sentence; Task 6's
   *  test holds the two together. */
  it("names the capability, the call and the manifest field", () => {
    expect(fileTreeCapabilityMessage("setFileDecorations")).toBe(
      'Plugin requires "filetree" capability to call ui.setFileDecorations. Add "filetree" to the capabilities array in baram-plugin.json.',
    );
  });
});
