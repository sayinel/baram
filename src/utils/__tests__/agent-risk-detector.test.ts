// §11.6 Agent Risk Detector — detect risk level of content changes
import { describe, expect, it } from "vitest";

import { detectRisk } from "../agent-risk-detector";

describe("detectRisk", () => {
  it("returns low for minor text change", () => {
    const original = "Hello world.\nSecond line.\nThird line.";
    const modified = "Hello world.\nSecond line updated.\nThird line.";
    expect(detectRisk(original, modified)).toBe("low");
  });

  it("returns medium when >50% of headings changed", () => {
    const original = "# Title\n\n## Section A\n\n## Section B";
    const modified = "# New Title\n\n## New Section\n\n## Another";
    expect(detectRisk(original, modified)).toBe("medium");
  });

  it("returns medium when frontmatter fields added/removed", () => {
    const original = "---\ntitle: Test\n---\n\nContent";
    const modified = "---\ntitle: Test\nnew_field: value\n---\n\nContent";
    expect(detectRisk(original, modified)).toBe("medium");
  });

  it("returns high when file content changes >50%", () => {
    const original = "Line 1\nLine 2\nLine 3\nLine 4";
    const modified = "Completely different content here now.";
    expect(detectRisk(original, modified)).toBe("high");
  });
});
