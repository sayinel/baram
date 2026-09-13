// issue 545 — the verdict on one image destination, on strings.
//
// Which destinations are kept, staged or refused, and how the scope they are
// judged in is resolved from the document path and the context root.
import { describe, expect, it } from "vitest";

import {
  classifyImageSource,
  relativeScope,
} from "../export-image-source-policy";
import { IN_VAULT, KNOWN } from "./helpers/image-policy-fixtures";

describe("classifyImageSource", () => {
  it("keeps a staged mermaid asset and refuses any asset name this export did not produce", () => {
    expect(
      classifyImageSource("baram-asset:mermaid-0.png", IN_VAULT, KNOWN),
    ).toEqual({ kind: "keep", source: "baram-asset:mermaid-0.png" });
    // A document-written placeholder would reach pandoc as a bare file name.
    expect(
      classifyImageSource("baram-asset:mermaid-1.png", IN_VAULT, KNOWN),
    ).toEqual({
      kind: "refuse",
    });
    // Kept by the parser's view: the tab is gone from what is written out.
    expect(
      classifyImageSource("\tbaram-asset:mermaid-0.png", IN_VAULT, KNOWN),
    ).toEqual({ kind: "keep", source: "baram-asset:mermaid-0.png" });
    expect(classifyImageSource("baram-asset:../x", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
    expect(classifyImageSource("baram-asset:", IN_VAULT, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

  it("stages a relative path that stays inside the document's context, refuses one that leaves it", () => {
    expect(classifyImageSource("img/a.png", IN_VAULT, KNOWN)).toEqual({
      kind: "stage",
      source: "img/a.png",
    });
    // Up one level is still inside /vault.
    expect(classifyImageSource("../shared/a.png", IN_VAULT, KNOWN).kind).toBe(
      "stage",
    );
    expect(classifyImageSource("./a%20b.png", IN_VAULT, KNOWN).kind).toBe(
      "stage",
    );
    // Up two levels leaves /vault — judged on the string, so the export can
    // degrade to alt text instead of failing in the backend.
    for (const url of [
      "../../secret.png",
      "../../../etc/hosts",
      "%2e%2e/%2e%2e/secret.png",
      "img/../../../secret.png",
      "..\\..\\secret.png",
    ]) {
      expect(classifyImageSource(url, IN_VAULT, KNOWN), url).toEqual({
        kind: "refuse",
      });
    }
    // No scope at all — unsaved, or a file opened on its own.
    expect(classifyImageSource("img/a.png", null, KNOWN)).toEqual({
      kind: "refuse",
    });
  });

  it("resolves the scope from the document path and the context root, or not at all", () => {
    expect(relativeScope("/vault/notes/today.md", "/vault/")).toEqual({
      caseInsensitive: false,
      documentDir: "/vault/notes",
      root: "/vault",
    });
    expect(relativeScope("C:\\vault\\notes\\today.md", "C:\\vault")).toEqual({
      caseInsensitive: true,
      documentDir: "C:/vault/notes",
      root: "C:/vault",
    });
    expect(relativeScope(null, "/vault")).toBeNull();
    expect(relativeScope("/Users/me/solo.md", null)).toBeNull();
  });

  it("refuses everything pandoc would read from outside the document's tree", () => {
    for (const url of [
      "/etc/hosts",
      "/Users/me/.ssh/id_rsa",
      "\\\\server\\share\\x.png",
      "\\Windows\\x.png",
      "C:\\Users\\me\\x.png",
      "c:/x.png",
      "file:///etc/hosts",
      "FILE:///etc/hosts",
      " file:///etc/hosts",
      "data:image/png;base64,AAAA",
      "https://tracker.example/pixel.gif",
      "http://x/y.png",
      "//tracker.example/pixel.gif",
      "java\tscript:alert(1)",
      "",
      "#fragment",
      "?query",
    ]) {
      expect(classifyImageSource(url, IN_VAULT, KNOWN), url).toEqual({
        kind: "refuse",
      });
    }
  });
});

describe("relativeScope", () => {
  it("judges drive-letter case before normalisation strips the separator off a drive root (issue 631)", () => {
    // `C:\` becomes `C:` once normalised — no longer drive-absolute to look
    // at — so the rule is applied to the inputs as given.
    expect(relativeScope("C:\\a.md", "C:\\")).toEqual({
      caseInsensitive: true,
      documentDir: "C:",
      root: "C:",
    });
    expect(relativeScope("/vault/notes/a.md", "/vault/")).toEqual({
      caseInsensitive: false,
      documentDir: "/vault/notes",
      root: "/vault",
    });
  });
});
