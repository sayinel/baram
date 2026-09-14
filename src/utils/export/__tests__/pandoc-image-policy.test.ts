// issues 545 and 631 — the one notice a Pandoc export leaves behind: what was
// refused and why, what the cap left out, what could not be read. One string,
// because the toast store shows one toast at a time.
import { describe, expect, it } from "vitest";

import { imagePolicyNotice } from "../pandoc-image-policy";

type Counts = Parameters<typeof imagePolicyNotice>[0];
const counts = (over: Partial<Counts>): Counts => ({
  overCap: 0,
  refused: 0,
  scoped: true,
  unsupportedHtml: 0,
  ...over,
});

describe("imagePolicyNotice", () => {
  it("says nothing when nothing was left out", () => {
    expect(imagePolicyNotice(counts({}), "en")).toBeNull();
    expect(imagePolicyNotice(counts({ scoped: false }), "ko")).toBeNull();
  });

  it("names the refused images and why, then the cap, then the unread fragments", () => {
    const notice = imagePolicyNotice(
      counts({ overCap: 2, refused: 1, unsupportedHtml: 3 }),
      "en",
    );
    expect(notice).toContain("1 image(s) left out");
    expect(notice).toContain("first 256 images");
    expect(notice).toContain("2 more");
    expect(notice).toContain("3 HTML fragment(s)");
    const at = (text: string): number => notice!.indexOf(text);
    expect(at("left out")).toBeLessThan(at("first 256"));
    expect(at("first 256")).toBeLessThan(at("HTML fragment"));
  });

  it("explains the cap on its own, in both languages", () => {
    expect(imagePolicyNotice(counts({ overCap: 44 }), "en")).toBe(
      "Only the first 256 images were embedded; 44 more became their alt text.",
    );
    expect(imagePolicyNotice(counts({ overCap: 44 }), "ko")).toContain("256");
    expect(imagePolicyNotice(counts({ overCap: 44 }), "ko")).toContain("44");
  });

  it("uses the unscoped wording when the document had no vault or folder", () => {
    expect(
      imagePolicyNotice(counts({ refused: 2, scoped: false }), "en"),
    ).toContain("saved inside an open vault or folder");
  });
});
