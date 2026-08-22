// §294 최종 게이트 I3 — the DOM src fix-up, tested directly.
//
// ‼️ Why a direct test as well as the HtmlBlockView one: the `asset:` guard is
// an IDEMPOTENCE guard, and no markdown input can reach it through the view.
// DOMPurify's default ALLOWED_URI_REGEXP does not include the `asset:` scheme,
// so an `asset:` src in the stored content is stripped before the fix-up ever
// sees it, and React re-injects raw innerHTML on every render — so in the view
// the srcs are always raw when the fix-up runs. That makes the guard an
// unobservable property through that surface, and an unobservable property
// cannot be pinned by any assertion there. Calling the function twice on one
// DOM is the injected fixture that makes it observable.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { resolveMediaSrcsIn } from "../resolve-html-media-srcs";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

function srcs(el: HTMLElement): (null | string)[] {
  return [...el.querySelectorAll("img")].map((i) => i.getAttribute("src"));
}

describe("resolveMediaSrcsIn (§294 gate I3)", () => {
  it("resolves a relative path against baseDir", () => {
    const el = root('<img src="assets/a.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(srcs(el)).toEqual(["asset://localhost//vault/notes/assets/a.png"]);
  });

  it("resolves an absolute local path without prefixing baseDir", () => {
    const el = root('<img src="/abs/a.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(srcs(el)).toEqual(["asset://localhost//abs/a.png"]);
  });

  it("leaves http, https and data srcs alone", () => {
    const el = root(
      '<img src="http://x.test/a.png"><img src="https://x.test/b.png"><img src="data:image/png;base64,AA">',
    );
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(srcs(el)).toEqual([
      "http://x.test/a.png",
      "https://x.test/b.png",
      "data:image/png;base64,AA",
    ]);
  });

  it("leaves the Windows asset spelling alone (isRemoteOrData catches it)", () => {
    const el = root('<img src="http://asset.localhost/%2Fvault%2Fa.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(srcs(el)).toEqual(["http://asset.localhost/%2Fvault%2Fa.png"]);
  });

  // THE guard: a second pass must not prefix baseDir onto its own output.
  it("is idempotent — a second call does not re-prefix", () => {
    const el = root('<img src="a.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    const once = srcs(el);
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(srcs(el)).toEqual(once);
    expect(srcs(el)).toEqual(["asset://localhost//vault/notes/a.png"]);
  });

  it("is idempotent even when baseDir changed between the two calls", () => {
    const el = root('<img src="a.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    resolveMediaSrcsIn(el, "/vault/other");
    expect(srcs(el)).toEqual(["asset://localhost//vault/notes/a.png"]);
  });

  // ‼️ The remote/data skip is observable only as a WRITE, not as a value:
  // resolveMediaSrc passes those through unchanged, so deleting the guard
  // leaves the resulting src identical (mutation testing proved that — the
  // value assertions above stayed green). The guard matters because the caller
  // runs this on EVERY render, and re-assigning an identical src can re-trigger
  // a fetch for a remote image in a real engine. So assert the call, not the value.
  it("does not write the src attribute at all for a remote image", () => {
    const el = root('<img src="https://x.test/a.png">');
    const img = el.querySelector("img")!;
    const spy = vi.spyOn(img, "setAttribute");
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not write the src attribute again on a second pass", () => {
    const el = root('<img src="a.png">');
    resolveMediaSrcsIn(el, "/vault/notes");
    const img = el.querySelector("img")!;
    const spy = vi.spyOn(img, "setAttribute");
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(spy).not.toHaveBeenCalled();
  });

  // ‼️ THE gap the verification pass found. The selector was `img[src]`, and
  // the premise behind that was wrong: `USE_PROFILES: { html: true }` already
  // allows `video`, `audio`, `source` and `track`, and `ADD_TAGS` only ADDS to
  // that set. Verified against the real dompurify 3.4.13 with the app's actual
  // SANITIZE_CONFIG. So a refused `<video src="assets/clip.mp4">` did not
  // vanish — it rendered as a LIVE player with an unresolved relative src, an
  // empty black box that looks like a broken app rather than a preserved tag.
  //
  // The selector now keys off the URL ATTRIBUTE rather than the element name,
  // so the next member (audio, source, track) cannot escape the way video did.
  it("resolves a video src", () => {
    const el = root('<video src="assets/clip.mp4" width="60%"></video>');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(el.querySelector("video")?.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4",
    );
  });

  it("resolves an audio src", () => {
    const el = root('<audio src="assets/a.mp3" controls></audio>');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(el.querySelector("audio")?.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/a.mp3",
    );
  });

  it("resolves a <source> child inside a video", () => {
    const el = root('<video><source src="assets/clip.mp4"></video>');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(el.querySelector("source")?.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4",
    );
  });

  it("resolves a track src", () => {
    const el = root('<video src="a.mp4"><track src="subs.vtt"></video>');
    resolveMediaSrcsIn(el, "/d");
    expect(el.querySelector("track")?.getAttribute("src")).toBe(
      "asset://localhost//d/subs.vtt",
    );
  });

  // `<video src="clip.mp4" controls poster="p.jpg">` is a shape the parser
  // genuinely refuses (controls and poster are both outside the allowlist), so
  // resolving only src would leave a broken poster over a working player.
  it("resolves a video poster alongside its src", () => {
    const el = root('<video src="clip.mp4" controls poster="p.jpg"></video>');
    resolveMediaSrcsIn(el, "/vault/notes");
    const v = el.querySelector("video")!;
    expect(v.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/clip.mp4",
    );
    expect(v.getAttribute("poster")).toBe(
      "asset://localhost//vault/notes/p.jpg",
    );
  });

  it("leaves a remote video src alone", () => {
    const el = root('<video src="https://x.test/a.mp4"></video>');
    resolveMediaSrcsIn(el, "/vault/notes");
    expect(el.querySelector("video")?.getAttribute("src")).toBe(
      "https://x.test/a.mp4",
    );
  });

  it("is idempotent for a video src too", () => {
    const el = root('<video src="a.mp4"></video>');
    resolveMediaSrcsIn(el, "/vault/notes");
    resolveMediaSrcsIn(el, "/vault/other");
    expect(el.querySelector("video")?.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/a.mp4",
    );
  });

  it("resolves a mixed block of img, video and source in one pass", () => {
    const el = root(
      '<div><img src="a.png"><video src="b.mp4"></video><audio><source src="c.mp3"></audio></div>',
    );
    resolveMediaSrcsIn(el, "/d");
    expect(
      [...el.querySelectorAll("[src]")].map((e) => e.getAttribute("src")),
    ).toEqual([
      "asset://localhost//d/a.png",
      "asset://localhost//d/b.mp4",
      "asset://localhost//d/c.mp3",
    ]);
  });

  // Known limit, stated rather than silently carried: srcset survives
  // sanitization but is a comma-separated descriptor list, so it is left alone.
  it("leaves srcset unresolved (documented limit)", () => {
    const el = root('<img src="a.png" srcset="a2.png 2x">');
    resolveMediaSrcsIn(el, "/d");
    expect(el.querySelector("img")?.getAttribute("srcset")).toBe("a2.png 2x");
    expect(el.querySelector("img")?.getAttribute("src")).toBe(
      "asset://localhost//d/a.png",
    );
  });

  it("resolves every img, not just the first", () => {
    const el = root('<img src="a.png"><p>x</p><img src="sub/b.png">');
    resolveMediaSrcsIn(el, "/d");
    expect(srcs(el)).toEqual([
      "asset://localhost//d/a.png",
      "asset://localhost//d/sub/b.png",
    ]);
  });

  it("skips an img with no src attribute at all", () => {
    const el = root('<img alt="x">');
    resolveMediaSrcsIn(el, "/d");
    expect(srcs(el)).toEqual([null]);
  });

  it("touches nothing when there is no img", () => {
    const el = root("<div><p>plain</p></div>");
    const before = el.innerHTML;
    resolveMediaSrcsIn(el, "/d");
    expect(el.innerHTML).toBe(before);
  });

  // A null baseDir happens on a single-file open (§89) with no active tab dir.
  it("still converts a relative path when baseDir is null", () => {
    const el = root('<img src="a.png">');
    resolveMediaSrcsIn(el, null);
    expect(srcs(el)).toEqual(["asset://localhost/a.png"]);
  });

  it("adds no elements and removes none", () => {
    const el = root('<div><img src="a.png"><span>t</span></div>');
    const count = el.querySelectorAll("*").length;
    resolveMediaSrcsIn(el, "/d");
    expect(el.querySelectorAll("*").length).toBe(count);
    expect(el.querySelector("span")?.textContent).toBe("t");
  });
});
