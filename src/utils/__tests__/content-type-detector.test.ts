import { describe, expect, it } from "vitest";

import { detectContentType } from "../content-type-detector";

describe("detectContentType", () => {
  it("returns code when selection contains codeBlock", () => {
    const nodeTypes = [{ type: "codeBlock" }];
    expect(detectContentType(nodeTypes)).toBe("code");
  });

  it("returns math when selection contains mathBlock", () => {
    const nodeTypes = [{ type: "mathBlock" }];
    expect(detectContentType(nodeTypes)).toBe("math");
  });

  it("returns table when selection contains table", () => {
    const nodeTypes = [{ type: "table" }];
    expect(detectContentType(nodeTypes)).toBe("table");
  });

  it("returns structure when selection has heading + paragraph", () => {
    const nodeTypes = [{ type: "heading" }, { type: "paragraph" }];
    expect(detectContentType(nodeTypes)).toBe("structure");
  });

  it("returns text as default for paragraphs only", () => {
    const nodeTypes = [{ type: "paragraph" }];
    expect(detectContentType(nodeTypes)).toBe("text");
  });

  it("prioritizes code over text when mixed", () => {
    const nodeTypes = [{ type: "paragraph" }, { type: "codeBlock" }];
    expect(detectContentType(nodeTypes)).toBe("code");
  });

  it("returns diagram when selection contains mermaidBlock", () => {
    expect(detectContentType([{ type: "mermaidBlock" }])).toBe("diagram");
  });

  it("returns svg when selection contains svgBlock", () => {
    expect(detectContentType([{ type: "svgBlock" }])).toBe("svg");
  });
});
