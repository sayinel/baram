// issue 631 — what an `<img …>` tag says as HTML reads it, and when the
// editor's own width and title are kept.
import { describe, expect, it } from "vitest";

import { editorImageMetadata, readImgTag } from "../export-img-attributes";

describe("readImgTag", () => {
  it("reads attributes as HTML does: decoded by attribute rules, first duplicate kept, names case-insensitive, src trimmed", () => {
    const loose = readImgTag(
      "<IMG SRC=' img/a&amp;b.png ' src='img/d.png' ALT='say &quot;hi&quot;' alt='x'>",
    );
    expect(loose.src).toBe("img/a&b.png");
    expect(loose.alt).toBe('say "hi"');
    expect(loose.attrs?.get("src")).toBe(" img/a&b.png ");
  });

  it("keeps a legacy reference literal before a letter or `=`, decodes it otherwise", () => {
    expect(readImgTag('<img src="img/&copycat.png">').src).toBe(
      "img/&copycat.png",
    );
    expect(readImgTag('<img src="img/a&amp=x.png">').src).toBe(
      "img/a&amp=x.png",
    );
    expect(readImgTag('<img src="img/&copy.png">').src).toBe("img/©.png");
  });

  it("reports no source for an empty or absent src", () => {
    expect(readImgTag("<img/>")).toMatchObject({ alt: null, src: null });
    expect(readImgTag('<img src="" alt="empty">')).toMatchObject({
      alt: "empty",
      src: null,
    });
  });
});

describe("editorImageMetadata", () => {
  it("keeps the editor's size only when the strict parser and HTML agree on every attribute it copies", () => {
    const own = '<img src="img/a.png" alt="A" title="T" width="640">';
    expect(editorImageMetadata(own, readImgTag(own))).toEqual({
      title: "T",
      widthPercent: 100,
      widthPixel: 640,
    });
    const fooled =
      '<img alt=\'src="img/fake.png"\' src="img/real.png" width="640">';
    expect(editorImageMetadata(fooled, readImgTag(fooled))).toEqual({});
    // A tag the strict parser refuses outright (single quotes are not its
    // spelling) keeps no size either, before any agreement is checked.
    const loose = "<img src='img/a.png' width='640'>";
    expect(editorImageMetadata(loose, readImgTag(loose))).toEqual({});
  });
});
