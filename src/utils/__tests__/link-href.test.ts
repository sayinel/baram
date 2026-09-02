// issue 499 — the link destination policy.
//
// One question, asked at every place a link destination becomes live: may
// this href be emitted as `<a href>` (editor DOM, clipboard HTML, HTML/PDF
// export) or navigated on Cmd+click? The answer never touches the document
// model — a refused destination stays in the file byte-for-byte and is simply
// not wired up.
//
// The classification goes through the WHATWG URL parser on purpose: that is
// the parser the browser applies to `href` before deciding what it means, so
// `" JAVA\tscript:alert(1)"` is recognised as `javascript:` here exactly as it
// would be there. A substring or regex check is not — the previous
// `a[href]:not([href *= 'javascript:' i])` selector let `java\tscript:`
// through and blocked `https://…?q=javascript:`.
import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

import { isAllowedLinkHref, SANITIZER_ALLOWED_URI_REGEXP } from "../link-href";

describe("isAllowedLinkHref — destinations that stay live", () => {
  it.each([
    "https://example.com/a?b=c#d",
    "http://example.com",
    "mailto:a@b.c",
    "tel:+1-555-0100",
    "sms:+15550100",
    "xmpp:a@b.c",
    "#heading",
    "./notes/a.md",
    "../a.md",
    "a.md",
    "sub/doc.md",
    "notes/a b.md",
    "www.example.com",
    // The literal substring is a query value, not a scheme — the old
    // selector refused this one.
    "https://example.test/?q=javascript:alert(1)",
  ])("%j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(true);
  });

  it("treats a missing href as nothing to neutralise", () => {
    expect(isAllowedLinkHref(null)).toBe(true);
    expect(isAllowedLinkHref(undefined)).toBe(true);
    expect(isAllowedLinkHref("")).toBe(true);
  });
});

describe("isAllowedLinkHref — script-capable schemes are refused in every spelling the browser accepts", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " jAvAsCrIpT:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java\rscript:alert(1)",
    "\u0001javascript:alert(1)",
    "vbscript:msgbox(1)",
    "vb\rscript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/0b3c",
  ])("%j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(false);
  });
});

describe("isAllowedLinkHref — the policy is the HTML-block sanitizer's, not 'anything but script'", () => {
  // The same exported document already holds `<a href>` inside HTML blocks to
  // DOMPurify's default scheme set. A markdown link is not allowed more.
  it.each([
    "file:///Users/me/a.md",
    "obsidian://open?vault=v",
    "zotero://select/items/1",
    "ms-msdt:/id PCWDiagnostic",
    "C:\\notes\\a.md",
  ])("refuses %j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(false);
  });

  it("fails closed when the URL parser cannot parse the href", () => {
    expect(isAllowedLinkHref("http://[")).toBe(false);
    expect(isAllowedLinkHref("javascript://[")).toBe(false);
  });

  // A protocol-relative href borrows the document's scheme: the webview's in
  // the editor, `file:` in an exported page (where `//host/share` is a UNC
  // path). Against the fixed https base it would classify as https purely by
  // accident of the base, so it is refused outright — in every spelling the
  // parser treats as two leading slashes.
  it.each([
    "//evil.example/x",
    "\\\\evil.example\\x",
    "/\\evil.example/x",
    "  //evil.example/x",
    "/\t/evil.example/x",
  ])("refuses the protocol-relative %j", (href) => {
    expect(isAllowedLinkHref(href)).toBe(false);
  });

  it("still allows a single leading slash (root-relative path)", () => {
    expect(isAllowedLinkHref("/notes/a.md")).toBe(true);
  });
});

// The HTML/SVG sanitizers consume the policy as a DOMPurify regexp. DOMPurify
// strips ASCII whitespace/controls from the value before testing it, so the
// comparison below feeds the regexp what DOMPurify would.
describe("SANITIZER_ALLOWED_URI_REGEXP agrees with isAllowedLinkHref", () => {
  const ATTR_WHITESPACE =
    /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g; // eslint-disable-line no-control-regex

  it.each([
    // allowed by both
    ["https://example.com/a?b=c#d", true],
    ["mailto:a@b.c", true],
    ["tel:+1-555-0100", true],
    ["#heading", true],
    ["./notes/a.md", true],
    ["notes/a b.md", true],
    ["/notes/a.md", true],
    ["www.example.com", true],
    ["https://example.test/?q=javascript:alert(1)", true],
    // refused by both
    ["javascript:alert(1)", false],
    ["JavaScript:alert(1)", false],
    ["java\tscript:alert(1)", false],
    ["\u0001javascript:alert(1)", false],
    ["vbscript:msgbox(1)", false],
    ["data:text/html,<script>1</script>", false],
    ["blob:https://example.com/0b3c", false],
    ["file:///Users/me/a.md", false],
    ["obsidian://open?vault=v", false],
    ["C:\\notes\\a.md", false],
    ["//evil.example/x", false],
    ["\\\\evil.example\\x", false],
    ["/\t/evil.example/x", false],
  ] as const)("%j → %s on both sides", (href, allowed) => {
    expect(isAllowedLinkHref(href)).toBe(allowed);
    expect(
      SANITIZER_ALLOWED_URI_REGEXP.test(href.replace(ATTR_WHITESPACE, "")),
    ).toBe(allowed);
  });
});

// `SANITIZER_ALLOWED_URI_REGEXP` is a hand copy of a DOMPurify constant the
// package does not export. This pins the "default plus one lookahead" claim
// against the INSTALLED DOMPurify by behaviour: over a scheme table, an anchor
// sanitized with the default config and one sanitized with our pattern must
// agree everywhere except the protocol-relative rows. A DOMPurify bump that
// changes its default scheme list fails here instead of silently making the
// comment in link-href.ts false.
describe("SANITIZER_ALLOWED_URI_REGEXP tracks the installed DOMPurify default", () => {
  function hrefAfter(href: string, config: object): null | string {
    const out = DOMPurify.sanitize(`<a href="${href}">t</a>`, config);
    return (
      new DOMParser()
        .parseFromString(out, "text/html")
        .querySelector("a")
        ?.getAttribute("href") ?? null
    );
  }
  const defaultConfig = {};
  const ourConfig = { ALLOWED_URI_REGEXP: SANITIZER_ALLOWED_URI_REGEXP };

  it.each([
    "https://example.com/a",
    "http://example.com",
    "ftp://example.com/f",
    "ftps://example.com/f",
    "mailto:a@b.c",
    "tel:+1",
    "callto:+1",
    "sms:+1",
    "cid:part1",
    "xmpp:a@b.c",
    "matrix:r/room:example.org",
    "#frag",
    "./a.md",
    "a.md",
    "/root/a.md",
    "www.example.com",
    "javascript:alert(1)",
    "vbscript:x",
    "data:text/html,x",
    "blob:https://a/b",
    "file:///a",
    "obsidian://open",
    "zotero://select",
    "gopher://x",
    "C:\\a.md",
  ])("agrees with the default on %j", (href) => {
    expect(hrefAfter(href, ourConfig)).toBe(hrefAfter(href, defaultConfig));
  });

  it.each(["//evil.example/x", "\\\\evil.example\\x"])(
    "differs from the default only by refusing the protocol-relative %j",
    (href) => {
      expect(hrefAfter(href, defaultConfig)).toBe(href);
      expect(hrefAfter(href, ourConfig)).toBeNull();
    },
  );
});
