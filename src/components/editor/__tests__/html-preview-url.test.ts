// §5.1 Preview URL construction for the `baramhtml:` scheme.

import { describe, expect, it, vi } from "vitest";

// The real one reaches into `window.__TAURI_INTERNALS__`. This reproduces its
// documented shape — `${protocol}://localhost/${encodeURIComponent(path)}` — so the
// origin these tests assert against is the origin the app actually gets.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol = "asset") =>
    `${protocol}://localhost/${encodeURIComponent(path)}`,
}));

import { externalUrlToOpen, htmlPreviewUrl } from "../html-preview-url";

describe("htmlPreviewUrl", () => {
  /** The bug this scheme exists to fix: a document served from one opaque URL
   *  segment has no directory for `img/a.png` to resolve against. */
  it("keeps path separators so relative references have a directory", () => {
    const url = htmlPreviewUrl("/Users/me/docs/index.html");
    expect(url).toBe("baramhtml://localhost/Users/me/docs/index.html");
    expect(new URL("img/a.png", url).href).toBe(
      "baramhtml://localhost/Users/me/docs/img/a.png",
    );
  });

  it("encodes each segment without encoding the separators", () => {
    expect(htmlPreviewUrl("/Users/me/my docs/a+b.html")).toBe(
      "baramhtml://localhost/Users/me/my%20docs/a%2Bb.html",
    );
  });

  it("encodes a '#' in a filename so it cannot start a fragment", () => {
    const url = htmlPreviewUrl("/Users/me/draft #2.html");
    expect(url).toBe("baramhtml://localhost/Users/me/draft%20%232.html");
    expect(new URL(url).hash).toBe("");
  });

  it("normalizes Windows separators and keeps the drive letter a segment", () => {
    expect(htmlPreviewUrl("C:\\Users\\me\\a.html")).toBe(
      "baramhtml://localhost/C%3A/Users/me/a.html",
    );
  });

  it("appends the save-driven cache-buster only when there is one", () => {
    expect(htmlPreviewUrl("/a/b.html", 1712)).toBe(
      "baramhtml://localhost/a/b.html?v=1712",
    );
    expect(htmlPreviewUrl("/a/b.html", 0)).toBe(
      "baramhtml://localhost/a/b.html",
    );
    expect(htmlPreviewUrl("/a/b.html")).toBe("baramhtml://localhost/a/b.html");
  });
});

describe("externalUrlToOpen", () => {
  it("passes http and https through", () => {
    expect(externalUrlToOpen("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(externalUrlToOpen("http://example.com/")).toBe(
      "http://example.com/",
    );
  });

  /** The bridge runs inside the previewed document, so what arrives here is
   *  page-controlled: a page that wants the OS to run something asks for a
   *  scheme that is an instruction rather than a page. */
  it("rejects every scheme that is not http or https", () => {
    expect(externalUrlToOpen("file:///etc/passwd")).toBeNull();
    expect(externalUrlToOpen("javascript:alert(1)")).toBeNull();
    expect(externalUrlToOpen("mailto:a@b.c")).toBeNull();
    expect(
      externalUrlToOpen("baramhtml://localhost/Users/me/a.html"),
    ).toBeNull();
    expect(externalUrlToOpen("vscode://file/etc/hosts")).toBeNull();
  });

  it("rejects anything that is not a parseable absolute URL", () => {
    expect(externalUrlToOpen("not a url")).toBeNull();
    expect(externalUrlToOpen("/relative/path")).toBeNull();
    expect(externalUrlToOpen(undefined)).toBeNull();
    expect(externalUrlToOpen(null)).toBeNull();
    expect(externalUrlToOpen({ href: "https://example.com" })).toBeNull();
  });
});
