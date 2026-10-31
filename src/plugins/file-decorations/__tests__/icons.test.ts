// §395 spec 0074 D6 · §5.2 · §7 "SVG" — a plugin's icon is sanitized, must be one svg element, and is
// drawn as a mask: a rule for a class the host names, in one style element. The SVG never enters the
// DOM, and the style text holds nothing the plugin wrote except the percent-encoded URL.
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePluginStore } from "../../../stores/system/plugin";
import {
  __resetFileIcons,
  defineIcon,
  iconClassOf,
  releaseIcons,
} from "../icons";
import { MAX_FILE_ICONS } from "../limits";
import { SVG_ROOT_MESSAGE, TOO_MANY_ICONS_MESSAGE } from "../validate";

const SHAPE = '<svg viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>';

/** One rule as `icons.ts` writes it: the host's class, the URL twice, nothing else. */
const RULE =
  /^\.fd-icon-\d+\{-webkit-mask-image:url\("data:image\/svg\+xml,[A-Za-z0-9\-_.!~*'()%]*"\);mask-image:url\("data:image\/svg\+xml,[A-Za-z0-9\-_.!~*'()%]*"\)\}$/u;

/** The style element's text, or "" when there is none. */
function sheet(): string {
  return (
    document.head.querySelector("style[data-baram-file-icons]")?.textContent ??
    ""
  );
}

/** The SVG a class's rule carries, decoded. */
function svgOf(className: string): string {
  const rule =
    sheet()
      .split("\n")
      .find((line) => line.startsWith(`.${className}{`)) ?? "";
  const encoded = /mask-image:url\("data:image\/svg\+xml,([^"]*)"\)\}$/u.exec(
    rule,
  )?.[1];
  return encoded === undefined ? "" : decodeURIComponent(encoded);
}

afterEach(() => {
  __resetFileIcons();
  usePluginStore.setState({
    devMode: { active: false, devBuild: false, enabled: false },
  });
  vi.restoreAllMocks();
});

describe("defineIcon (D6)", () => {
  it("draws an icon as a host-named class whose rule masks with the SVG", () => {
    expect(defineIcon("p", "star", SHAPE)).toBeNull();
    const className = iconClassOf("p", "star");
    expect(className).toMatch(/^fd-icon-\d+$/u);
    const svg = svgOf(className!);
    expect(svg).toContain('<path d="M0 0h16v16z"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // Not in the DOM: the only element the definition added is the style element.
    expect(document.body.querySelector("svg")).toBeNull();
  });

  /** §7 — what the sanitizer must take out. What fails this: an icon path that skips
   *  `sanitizePluginMarkup` (the script, the handler, the remote image and the foreign object would
   *  reach the URL). The pair is the `<path>` that stays. */
  it("sanitizes before drawing", () => {
    defineIcon(
      "p",
      "x",
      '<svg onload="steal()"><script>steal()</script><image href="https://example.com/a.png"/><foreignObject><p>x</p></foreignObject><path d="M0 0"/></svg>',
    );
    const svg = svgOf(iconClassOf("p", "x")!);
    expect(svg).toContain("<path");
    for (const gone of [
      "script",
      "steal",
      "onload",
      "https://",
      "foreignObject",
    ]) {
      expect(svg).not.toContain(gone);
    }
  });

  /** §7 — one svg root, whitespace beside it only. What fails this: taking the first element, or any
   *  element as the root. */
  it("refuses two roots, a root that is not svg, and text outside the root", () => {
    expect(defineIcon("p", "a", `${SHAPE}${SHAPE}`)).toBe(SVG_ROOT_MESSAGE);
    expect(defineIcon("p", "b", '<g><path d="M0 0"/></g>')).toBe(
      SVG_ROOT_MESSAGE,
    );
    expect(defineIcon("p", "c", `x${SHAPE}`)).toBe(SVG_ROOT_MESSAGE);
    expect(sheet()).toBe("");
    expect(defineIcon("p", "d", `\n  ${SHAPE}\n`)).toBeNull();
  });

  /** §7 — 64 icons, the 65th name refused, a redefinition at the cap taken: it replaces the rule
   *  (rule count unchanged, class unchanged, URL changed). What fails this: a cap that counts
   *  redefinitions, or a redefinition that mints a new class (every row using it would re-render). */
  it("holds 64 icons a plugin and redefines in place", () => {
    for (let i = 0; i < MAX_FILE_ICONS; i += 1) {
      expect(defineIcon("p", `i${i}`, SHAPE)).toBeNull();
    }
    expect(defineIcon("p", "one-more", SHAPE)).toBe(TOO_MANY_ICONS_MESSAGE);
    const before = iconClassOf("p", "i0")!;
    const rules = sheet().split("\n").length;
    expect(
      defineIcon("p", "i0", '<svg viewBox="0 0 8 8"><circle r="4"/></svg>'),
    ).toBeNull();
    expect(iconClassOf("p", "i0")).toBe(before);
    expect(sheet().split("\n")).toHaveLength(rules);
    expect(svgOf(before)).toContain("<circle");
    expect(defineIcon("q", "i0", SHAPE)).toBeNull(); // another plugin has its own 64
  });

  /** §7 — the style text is the host's class and the URL only. The SVG carries `"`, `}`, `\`, a
   *  newline and `</` in an attribute; none appears as written. What fails this: the URL built without
   *  `encodeURIComponent`, or a URL in an unquoted `url(…)`. */
  it("lets nothing the plugin wrote end the string, the rule or the style", () => {
    defineIcon(
      "p",
      "q",
      '<svg><path d="M0 0" data-x="&quot;}\\ \n&lt;/style&gt;"/></svg>',
    );
    expect(sheet()).toMatch(RULE);
    expect(sheet()).not.toContain("</");
    expect(sheet()).not.toContain("\\");
    expect(sheet()).not.toContain("\n");
  });

  it("removes a plugin's rules on release, and the style element with the last one", () => {
    defineIcon("p", "a", SHAPE);
    defineIcon("q", "a", SHAPE);
    releaseIcons("p");
    expect(iconClassOf("p", "a")).toBeUndefined();
    expect(iconClassOf("q", "a")).toBeDefined();
    releaseIcons("q");
    expect(
      document.head.querySelector("style[data-baram-file-icons]"),
    ).toBeNull();
  });

  /** §6 — what the sanitizer removed is logged in developer mode only. The pair: the same SVG with
   *  developer mode off logs nothing. */
  it("logs a sanitized removal in developer mode only", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    defineIcon("p", "a", '<svg onload="x()"><path d="M0 0"/></svg>');
    expect(info).not.toHaveBeenCalled();
    usePluginStore.setState({
      devMode: { active: true, devBuild: true, enabled: false },
    });
    defineIcon("p", "b", '<svg onload="x()"><path d="M0 0"/></svg>');
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toMatch(
      /^\[PluginFileIcon\] p b: the sanitizer removed at least \d+$/u,
    );
  });
});
