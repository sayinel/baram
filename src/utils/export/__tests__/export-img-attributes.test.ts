// issue 631 — what an `<img …>` tag says as HTML reads it, and when the
// editor's own width and title come with it.
import { describe, expect, it } from "vitest";

import { readExportImageTag } from "../export-img-attributes";

describe("readExportImageTag", () => {
  it("reads attributes as HTML does: decoded by attribute rules, first duplicate kept, names case-insensitive, src trimmed", () => {
    expect(
      readExportImageTag(
        "<IMG SRC=' img/a&amp;b.png ' src='img/d.png' ALT='say &quot;hi&quot;' alt='x'>",
      ),
    ).toEqual({ alt: 'say "hi"', src: "img/a&b.png" });
  });

  it("keeps a legacy reference literal before a letter or `=`, decodes it otherwise", () => {
    expect(readExportImageTag('<img src="img/&copycat.png">').src).toBe(
      "img/&copycat.png",
    );
    expect(readExportImageTag('<img src="img/a&amp=x.png">').src).toBe(
      "img/a&amp=x.png",
    );
    expect(readExportImageTag('<img src="img/&copy.png">').src).toBe(
      "img/©.png",
    );
  });

  it("reports no source for an empty or absent src", () => {
    expect(readExportImageTag("<img/>")).toEqual({ alt: null, src: null });
    expect(readExportImageTag('<img src="" alt="empty">')).toEqual({
      alt: "empty",
      src: null,
    });
  });

  it("carries the editor's title and size only when the strict parser and HTML agree on every attribute it copies", () => {
    expect(
      readExportImageTag('<img src="img/a.png" alt="A" title="T" width="640">'),
    ).toEqual({
      alt: "A",
      src: "img/a.png",
      title: "T",
      widthPercent: 100,
      widthPixel: 640,
    });
    // The strict parser's name scan is fooled by a quoted value that spells
    // another attribute; HTML is not, so the disagreement drops the size.
    expect(
      readExportImageTag(
        '<img alt=\'src="img/fake.png"\' src="img/real.png" width="640">',
      ),
    ).toEqual({ alt: 'src="img/fake.png"', src: "img/real.png" });
    // A tag the strict parser refuses outright (single quotes are not its
    // spelling) carries no size either, before any agreement is checked.
    expect(readExportImageTag("<img src='img/a.png' width='640'>")).toEqual({
      alt: null,
      src: "img/a.png",
    });
  });

  it("reads nothing where there is no document to parse in", () => {
    const saved = globalThis.document;
    // @ts-expect-error -- simulate a runtime without a DOM
    delete globalThis.document;
    try {
      expect(readExportImageTag('<img src="img/a.png" alt="A">')).toEqual({
        alt: null,
        src: null,
      });
    } finally {
      globalThis.document = saved;
    }
  });
});
