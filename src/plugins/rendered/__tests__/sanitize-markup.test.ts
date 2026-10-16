// §394 spec 0073 D8 · §7 — what survives from a plugin renderer's HTML · SVG. Every row is a pair:
// the refused shape and the shape a renderer legitimately writes, so a sanitizer that removed
// everything would fail as surely as one that removed nothing.
import { describe, expect, it } from "vitest";

import { MAX_RENDERED_NODES } from "../limits";
import { sanitizePluginMarkup } from "../sanitize-markup";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The sanitized fragment in a detached container, for querying. */
function clean(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.append(sanitizePluginMarkup(html).fragment);
  return div;
}

function svgElements(root: Element, localName: string): Element[] {
  return [...root.getElementsByTagNameNS(SVG_NS, localName)];
}

describe("sanitizePluginMarkup — elements (D8 ①)", () => {
  /** What fails this: a FORBID_TAGS list that drops one of these, or a profile that allows them.
   *  The `<script>`, `<style>`, `<link>`, `<meta>` and `<base>` rows put the element AFTER
   *  content: a leading one is put into `<head>` by the HTML parser and DOMPurify 3.4.16 returns
   *  the `<body>`, so it is gone whatever the lists say — `ADD_TAGS` naming it too (measured) —
   *  and the row could not fail. DOMPurify's default html list keeps `<style>`, so FORBID_TAGS is
   *  what removes one in the body; `script`, `link`, `meta` and `base` are in none of its four
   *  profile lists, so their rows fail when a profile or `ADD_TAGS` lets them in. */
  it.each([
    ["<p>x</p><script>x()</script>", "script"],
    ["<p>x</p><style>p{}</style>", "style"],
    ['<iframe src="https://e.com"></iframe>', "iframe"],
    ["<object></object><embed>", "object"],
    ['<p>x</p><link rel="stylesheet" href="https://e.com/x.css">', "link"],
    ['<p>x</p><meta http-equiv="refresh" content="0">', "meta"],
    ['<p>x</p><base href="https://e.com/">', "base"],
    ['<video src="https://e.com/v.mp4"></video>', "video"],
    ['<video poster="https://e.com/p.png"></video>', "video"],
    ['<audio src="https://e.com/a.mp3"></audio>', "audio"],
    ['<picture><source srcset="https://e.com/a.png"></picture>', "source"],
    ['<form action="https://e.com"><input name="q"></form>', "form"],
    ['<form><input name="q"></form>', "input"],
    ["<textarea>x</textarea><select><option>a</option></select>", "select"],
    [
      "<label>x</label><datalist></datalist><fieldset></fieldset><output></output>",
      "label",
    ],
    ["<dialog open>x</dialog>", "dialog"],
  ])("%s loses <%s>", (html, tag) => {
    expect(clean(html).querySelector(tag)).toBeNull();
  });

  /** The pair: ordinary content elements survive, `<button>` included — `data-action`'s home. */
  it("keeps tables, lists, links, images and buttons", () => {
    const out = clean(
      '<table><tr><td><a href="https://e.com">x</a></td></tr></table><ul><li>y</li></ul>' +
        '<img src="data:image/png;base64,AAAA" alt="i"><button data-action="go">Go</button>',
    );
    for (const tag of ["table", "td", "a", "ul", "li", "img", "button"]) {
      expect(out.querySelector(tag), tag).not.toBeNull();
    }
  });

  /** D8 ⑥ — the result is a fragment to `append`, not a string to parse a second time. */
  it("returns a DocumentFragment", () => {
    expect(sanitizePluginMarkup("<p>x</p>").fragment).toBeInstanceOf(
      DocumentFragment,
    );
  });
});

describe("sanitizePluginMarkup — attributes (D8 ②)", () => {
  /** What fails this: a FORBID_ATTR list that misses one of these. */
  it.each([
    ['<p style="color:red">x</p>', "p", "style"],
    ['<img src="data:image/png;base64,AA" onerror="x()">', "img", "onerror"],
    ["<div popover>x</div>", "div", "popover"],
    [
      '<button popovertarget="p" popovertargetaction="show">b</button>',
      "button",
      "popovertarget",
    ],
    [
      '<button popovertarget="p" popovertargetaction="show">b</button>',
      "button",
      "popovertargetaction",
    ],
    [
      '<button command="show-modal" commandfor="d">b</button>',
      "button",
      "command",
    ],
    [
      '<button command="show-modal" commandfor="d">b</button>',
      "button",
      "commandfor",
    ],
    [
      '<img src="data:image/png;base64,AA" srcset="https://e.com/a.png 1x" sizes="10px">',
      "img",
      "srcset",
    ],
    [
      '<img src="data:image/png;base64,AA" srcset="https://e.com/a.png 1x" sizes="10px">',
      "img",
      "sizes",
    ],
    ["<div data-vim-suspend>x</div>", "div", "data-vim-suspend"],
    ["<div data-node-view-content>x</div>", "div", "data-node-view-content"],
    ["<div data-tauri-drag-region>x</div>", "div", "data-tauri-drag-region"],
  ])("%s loses %s[%s]", (html, tag, attr) => {
    const el = clean(html).querySelector(tag);
    expect(el, tag).not.toBeNull();
    expect(el?.hasAttribute(attr)).toBe(false);
  });

  /** The pair: the two attributes the host gives meaning to (D11), and any other data-*, stay. */
  it("keeps data-note, data-action and other data-*", () => {
    const a = clean(
      '<a data-note="notes/a.md" data-row="3">a</a><button data-action="refresh">r</button>',
    );
    expect(a.querySelector("a")?.getAttribute("data-note")).toBe("notes/a.md");
    expect(a.querySelector("a")?.getAttribute("data-row")).toBe("3");
    expect(a.querySelector("button")?.getAttribute("data-action")).toBe(
      "refresh",
    );
  });
});

describe("sanitizePluginMarkup — URLs by attribute (D8 ③)", () => {
  /** What fails this: judging by element (an `<img>` allow-list) instead of by attribute, or
   *  `startsWith("data:")` instead of the URL parser + a case-blind media type. */
  it.each([
    ['<img src="https://e.com/p.png">', "img", "src"],
    ['<img src="p.png">', "img", "src"],
    ['<img src="data:text/html,x">', "img", "src"],
    [
      '<table background="https://e.com/x.png"><tr><td>x</td></tr></table>',
      "table",
      "background",
    ],
    ['<a href="javascript:alert(1)">x</a>', "a", "href"],
    ['<a href="data:text/html,x">x</a>', "a", "href"],
  ])("%s loses %s[%s]", (html, tag, attr) => {
    expect(clean(html).querySelector(tag)?.hasAttribute(attr)).toBe(false);
  });

  it.each([
    ['<img src="data:image/png;base64,AAAA">', "img", "src"],
    ['<img src="data:IMAGE/PNG;base64,AAAA">', "img", "src"],
    ['<a href="https://e.com/x">x</a>', "a", "href"],
    ['<a href="#section">x</a>', "a", "href"],
  ])("%s keeps %s[%s]", (html, tag, attr) => {
    expect(clean(html).querySelector(tag)?.hasAttribute(attr)).toBe(true);
  });

  /** SVG: a remote `href` goes on every element but `<a>`; a fragment and `data:image` stay. */
  it("judges SVG image · textPath · mpath href the same way", () => {
    const out = clean(
      '<svg><image href="https://e.com/x.png"/><image href="data:image/png;base64,AA"/>' +
        '<text><textPath href="https://e.com/p">t</textPath><textPath href="#p">u</textPath></text>' +
        '<path id="p" d="M0 0"/><animateMotion dur="1s"><mpath href="https://e.com/m"/></animateMotion>' +
        '<animateMotion dur="1s"><mpath href="#p"/></animateMotion></svg>',
    );
    const [remoteImage, dataImage] = svgElements(out, "image");
    expect(remoteImage.hasAttribute("href")).toBe(false);
    expect(dataImage.getAttribute("href")).toMatch(/^data:image\/png/);
    const [remotePath, fragmentPath] = svgElements(out, "textPath");
    expect(remotePath.hasAttribute("href")).toBe(false);
    expect(fragmentPath.getAttribute("href")).toBe("#p");
    const [remoteMpath, fragmentMpath] = svgElements(out, "mpath");
    expect(remoteMpath.hasAttribute("href")).toBe(false);
    expect(fragmentMpath.getAttribute("href")).toBe("#p");
  });
});

describe("sanitizePluginMarkup — CSS references in any attribute (D8 ④)", () => {
  /** What fails this: a string `url(` check (misses `u\72l(`), or keeping `url(#…)` only when
   *  nothing else is in the value — `fill="url(#g) url(https://…)"` must go. */
  it.each([
    '<svg><rect fill="url(https://e.com/x)"/></svg>',
    '<svg><rect fill="u\\72l(https://e.com/x)"/></svg>',
    '<svg><rect fill="url(#g) url(https://e.com/x)"/></svg>',
    '<svg><rect filter="url(data:image/svg+xml,x)"/></svg>',
  ])("%s loses fill/filter", (html) => {
    const rect = svgElements(clean(html), "rect")[0];
    expect(rect.hasAttribute("fill") || rect.hasAttribute("filter")).toBe(
      false,
    );
  });

  it("keeps a lone paint-server reference url(#…)", () => {
    const rect = svgElements(
      clean('<svg><rect fill="url(#g)"/></svg>'),
      "rect",
    )[0];
    expect(rect.getAttribute("fill")).toBe("url(#g)");
  });

  /** `values` of the animation elements that remain: D8 ④ reaches it, because DOMPurify 3.4.16's
   *  default svg attribute list keeps `values`. What fails this: the hook's CSS-reference branch
   *  gone. (`from` and `to` never reach the hook — the profile row below pins that.) */
  it("drops url(https://…) in animation values and keeps plain values", () => {
    const out = clean(
      '<svg><animateTransform attributeName="transform" type="scale" values="url(https://e.com/x)"/>' +
        '<animateTransform attributeName="transform" type="scale" values="0;1"/></svg>',
    );
    const [bad, good] = svgElements(out, "animateTransform");
    expect(bad.hasAttribute("values")).toBe(false);
    expect(good.getAttribute("values")).toBe("0;1");
  });
});

describe("sanitizePluginMarkup — the default profile, pinned (§7)", () => {
  /** What fails this: turning on `svgFilters` or `mathMl`, or an `ADD_TAGS` that reopens `use`,
   *  `set`, `animate` or `foreignObject` — `<animate attributeName="href">` would be back. */
  it("removes use, set, animate, foreignObject, feImage and MathML", () => {
    const out = clean(
      '<svg><use href="#x"/><set attributeName="href" to="x"/><animate attributeName="href" values="x"/>' +
        "<foreignObject><p>x</p></foreignObject>" +
        '<filter id="f"><feImage href="data:image/png;base64,AA"/></filter></svg><math><mi>x</mi></math>',
    );
    for (const name of ["use", "set", "animate", "foreignObject", "feImage"]) {
      expect(svgElements(out, name), name).toEqual([]);
    }
    expect(
      out.getElementsByTagNameNS("http://www.w3.org/1998/Math/MathML", "math")
        .length,
    ).toBe(0);
  });

  /** The three animation elements the default svg list keeps lose an `attributeName` naming
   *  `href` (DOMPurify 3.4.16 `_sanitizeAttributes`, after our hook); the element and an
   *  ordinary target stay. */
  it.each(["animateColor", "animateMotion", "animateTransform"])(
    "%s keeps itself but not attributeName=href / xlink:href",
    (name) => {
      const out = clean(
        `<svg><${name} attributeName="href" dur="1s"/><${name} attributeName="xlink:href" dur="1s"/>` +
          `<${name} attributeName="opacity" dur="1s"/></svg>`,
      );
      const [href, xlink, opacity] = svgElements(out, name);
      expect(href.hasAttribute("attributeName")).toBe(false);
      expect(xlink.hasAttribute("attributeName")).toBe(false);
      expect(opacity.getAttribute("attributeName")).toBe("opacity");
    },
  );

  /** DOMPurify 3.4.16's default svg attribute list has no `from` or `to`, so it drops them whole,
   *  whatever the value (measured) — no value of theirs reaches the D8 ④ hook. What fails this: an
   *  `ADD_ATTR` that lists them, which would need its own D8 ④ row. The pair: `values` on the same
   *  element stays. */
  it("drops from and to on an animation element, whatever their value", () => {
    const [el] = svgElements(
      clean(
        '<svg><animateTransform attributeName="transform" type="scale" from="0" to="1" values="0;1"/></svg>',
      ),
      "animateTransform",
    );
    expect(el.hasAttribute("from")).toBe(false);
    expect(el.hasAttribute("to")).toBe(false);
    expect(el.getAttribute("values")).toBe("0;1");
  });

  /** `style` in FORBID_TAGS removes an SVG `<style>` too. What fails this: dropping `style` from
   *  that list — DOMPurify 3.4.16's svg profile keeps `<svg><style>` (measured), and its CSS,
   *  `url()` included, would reach the shadow root past the CSS sanitizer. The pair: the `<rect>`
   *  beside it stays. */
  it("removes a <style> inside <svg>", () => {
    const out = clean("<svg><style>rect{fill:red}</style><rect/></svg>");
    expect(svgElements(out, "style")).toEqual([]);
    expect(svgElements(out, "rect")).toHaveLength(1);
  });
});

describe("sanitizePluginMarkup — the node cap (D8 ⑤)", () => {
  /** What fails this: no cap, or a cap counted before sanitizing (the removed `<script>`s would
   *  count). The pair sits exactly on the limit. */
  it("refuses one node over the cap and accepts the cap itself", () => {
    expect(() =>
      sanitizePluginMarkup("<b></b>".repeat(MAX_RENDERED_NODES + 1)),
    ).toThrow(`rendered output has more than ${MAX_RENDERED_NODES} nodes`);
    expect(
      sanitizePluginMarkup(
        "<b></b>".repeat(MAX_RENDERED_NODES) + "<script></script>".repeat(10),
      ).nodes,
    ).toBe(MAX_RENDERED_NODES);
  });

  /** §6 — the count the developer console gets: an `<iframe>` in the body is one (measured). The
   *  count is a LOWER bound (see `SanitizedMarkup.removed`) — a leading `<script>` would count 0 —
   *  so no row asserts it for input that starts with an element the parser puts into `<head>`. */
  it("counts what it removed, for the developer console", () => {
    expect(sanitizePluginMarkup("<iframe></iframe><p>x</p>").removed).toBe(1);
  });
});
