// §53 Notion markdown converter tests
import { describe, it, expect } from "vitest";
import {
  stripNotionId,
  emojiToCalloutType,
  buildFileMap,
  convertNotionCallouts,
  convertNotionLinks,
  convertNotionImages,
  convertNotionCsv,
  convertNotionMarkdown,
  cleanNotionPath,
} from "../notion-converter";

// ---------------------------------------------------------------------------
// 1. stripNotionId
// ---------------------------------------------------------------------------
describe("stripNotionId", () => {
  it("strips 32-char hex ID suffix from a name", () => {
    expect(stripNotionId("My Page 3a4b5c6d7e8f90123456789012345678")).toBe(
      "My Page",
    );
  });

  it("returns the name unchanged when no ID is present", () => {
    expect(stripNotionId("My Page")).toBe("My Page");
  });

  it("handles short names with hex ID", () => {
    expect(stripNotionId("A 00000000000000000000000000000000")).toBe("A");
  });

  it("does not strip if hex string is shorter than 32 chars", () => {
    expect(stripNotionId("Page abc123")).toBe("Page abc123");
  });

  it("handles names with numbers that are not hex IDs", () => {
    expect(stripNotionId("2024 Year Report")).toBe("2024 Year Report");
  });

  it("strips ID when name itself contains hex-looking words", () => {
    expect(stripNotionId("Cafe Babe abcdef01234567890abcdef012345678")).toBe(
      "Cafe Babe",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. emojiToCalloutType
// ---------------------------------------------------------------------------
describe("emojiToCalloutType", () => {
  it("maps light bulb to tip", () => {
    expect(emojiToCalloutType("\u{1F4A1}")).toBe("tip");
  });

  it("maps warning sign to warning", () => {
    expect(emojiToCalloutType("\u{26A0}\u{FE0F}")).toBe("warning");
  });

  it("maps exclamation to important", () => {
    expect(emojiToCalloutType("\u{2757}")).toBe("important");
  });

  it("maps info to info", () => {
    expect(emojiToCalloutType("\u{2139}\u{FE0F}")).toBe("info");
  });

  it("maps fire to danger", () => {
    expect(emojiToCalloutType("\u{1F525}")).toBe("danger");
  });

  it("maps memo to note", () => {
    expect(emojiToCalloutType("\u{1F4DD}")).toBe("note");
  });

  it("maps check mark to success", () => {
    expect(emojiToCalloutType("\u{2705}")).toBe("success");
  });

  it("maps cross mark to failure", () => {
    expect(emojiToCalloutType("\u{274C}")).toBe("failure");
  });

  it("maps pin to pin", () => {
    expect(emojiToCalloutType("\u{1F4CC}")).toBe("pin");
  });

  it("maps thought balloon to quote", () => {
    expect(emojiToCalloutType("\u{1F4AD}")).toBe("quote");
  });

  it("defaults unknown emoji to note", () => {
    expect(emojiToCalloutType("\u{1F600}")).toBe("note");
  });
});

// ---------------------------------------------------------------------------
// 3. buildFileMap
// ---------------------------------------------------------------------------
describe("buildFileMap", () => {
  it("builds a basic filename map stripping IDs", () => {
    const filenames = [
      "My Page 3a4b5c6d7e8f90123456789012345678.md",
      "Sub Page abcdef01234567890abcdef012345678.md",
    ];
    const map = buildFileMap(filenames);
    expect(map.get("My Page 3a4b5c6d7e8f90123456789012345678.md")).toBe(
      "My Page.md",
    );
    expect(map.get("Sub Page abcdef01234567890abcdef012345678.md")).toBe(
      "Sub Page.md",
    );
  });

  it("handles filename conflicts by appending (1), (2)", () => {
    const filenames = [
      "Note aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1.md",
      "Note aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2.md",
    ];
    const map = buildFileMap(filenames);
    const values = [...map.values()];
    expect(values).toContain("Note.md");
    expect(values).toContain("Note (1).md");
  });

  it("passes through filenames without IDs unchanged", () => {
    const filenames = ["README.md"];
    const map = buildFileMap(filenames);
    expect(map.get("README.md")).toBe("README.md");
  });

  it("handles non-markdown files", () => {
    const filenames = [
      "Data 3a4b5c6d7e8f90123456789012345678.csv",
    ];
    const map = buildFileMap(filenames);
    expect(map.get("Data 3a4b5c6d7e8f90123456789012345678.csv")).toBe(
      "Data.csv",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. convertNotionCallouts
// ---------------------------------------------------------------------------
describe("convertNotionCallouts", () => {
  it("converts a single-line callout", () => {
    const input = "<aside>\n\u{1F4A1} This is a tip\n</aside>";
    const expected = "> [!tip]\n> This is a tip";
    expect(convertNotionCallouts(input)).toBe(expected);
  });

  it("converts a multi-line callout", () => {
    const input =
      "<aside>\n\u{1F4A1} This is a tip\n\nWith multiple paragraphs\n</aside>";
    const expected =
      "> [!tip]\n> This is a tip\n>\n> With multiple paragraphs";
    expect(convertNotionCallouts(input)).toBe(expected);
  });

  it("converts multiple callouts in one document", () => {
    const input =
      "Before\n\n<aside>\n\u{1F4A1} Tip\n</aside>\n\nMiddle\n\n<aside>\n\u{26A0}\u{FE0F} Warning\n</aside>\n\nAfter";
    const result = convertNotionCallouts(input);
    expect(result).toContain("> [!tip]\n> Tip");
    expect(result).toContain("> [!warning]\n> Warning");
    expect(result).toContain("Before");
    expect(result).toContain("Middle");
    expect(result).toContain("After");
  });

  it("handles callout with no recognized emoji (defaults to note)", () => {
    const input = "<aside>\n\u{1F600} Something\n</aside>";
    expect(convertNotionCallouts(input)).toBe("> [!note]\n> Something");
  });

  it("returns content unchanged if no callouts", () => {
    const input = "# Hello\n\nWorld";
    expect(convertNotionCallouts(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 5. convertNotionLinks
// ---------------------------------------------------------------------------
describe("convertNotionLinks", () => {
  it("converts an internal Notion link to a wikilink", () => {
    const fileMap = new Map([
      ["My Page 3a4b5c6d7e8f90123456789012345678.md", "My Page.md"],
    ]);
    const input =
      "[My Page](My%20Page%203a4b5c6d7e8f90123456789012345678.md)";
    expect(convertNotionLinks(input, fileMap)).toBe("[[My Page]]");
  });

  it("does not convert external http links", () => {
    const fileMap = new Map<string, string>();
    const input = "[Google](https://google.com)";
    expect(convertNotionLinks(input, fileMap)).toBe(input);
  });

  it("uses display alias when link text differs from clean name", () => {
    const fileMap = new Map([
      ["Target abcdef01234567890abcdef012345678.md", "Target.md"],
    ]);
    const input =
      "[Custom Text](Target%20abcdef01234567890abcdef012345678.md)";
    expect(convertNotionLinks(input, fileMap)).toBe("[[Target|Custom Text]]");
  });

  it("handles multiple links in one line", () => {
    const fileMap = new Map([
      ["Page A aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1.md", "Page A.md"],
      ["Page B bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md", "Page B.md"],
    ]);
    const input =
      "See [Page A](Page%20A%20aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1.md) and [Page B](Page%20B%20bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md)";
    const result = convertNotionLinks(input, fileMap);
    expect(result).toBe("See [[Page A]] and [[Page B]]");
  });

  it("leaves links unchanged if target not in fileMap", () => {
    const fileMap = new Map<string, string>();
    const input = "[Unknown](Unknown%20Page.md)";
    expect(convertNotionLinks(input, fileMap)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 6. convertNotionImages
// ---------------------------------------------------------------------------
describe("convertNotionImages", () => {
  it("strips hex ID from image directory path", () => {
    const fileMap = new Map<string, string>();
    const input =
      "![image](My%20Page%203a4b5c6d7e8f90123456789012345678/Untitled.png)";
    expect(convertNotionImages(input, fileMap)).toBe(
      "![image](My%20Page/Untitled.png)",
    );
  });

  it("leaves clean image paths unchanged", () => {
    const fileMap = new Map<string, string>();
    const input = "![photo](images/photo.jpg)";
    expect(convertNotionImages(input, fileMap)).toBe(input);
  });

  it("handles URL-encoded spaces in directory names", () => {
    const fileMap = new Map<string, string>();
    const input =
      "![pic](My%20Long%20Page%20Name%20aabbccdd00112233445566778899aabb/img.png)";
    expect(convertNotionImages(input, fileMap)).toBe(
      "![pic](My%20Long%20Page%20Name/img.png)",
    );
  });

  it("handles external image URLs (no change)", () => {
    const fileMap = new Map<string, string>();
    const input = "![ext](https://example.com/image.png)";
    expect(convertNotionImages(input, fileMap)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// 7. convertNotionCsv
// ---------------------------------------------------------------------------
describe("convertNotionCsv", () => {
  it("converts basic CSV to frontmatter + table", () => {
    const csv = "Name,Age,City\nAlice,30,Seoul\nBob,25,Busan";
    const result = convertNotionCsv(csv);
    expect(result.frontmatter).toContain("Name: Alice");
    expect(result.table).toContain("| Name | Age | City |");
    expect(result.table).toContain("| Alice | 30 | Seoul |");
    expect(result.table).toContain("| Bob | 25 | Busan |");
  });

  it("handles quoted fields with commas", () => {
    const csv = 'Name,Description\nAlice,"Hello, World"';
    const result = convertNotionCsv(csv);
    expect(result.table).toContain("| Alice | Hello, World |");
  });

  it("handles empty cells", () => {
    const csv = "A,B,C\n1,,3";
    const result = convertNotionCsv(csv);
    expect(result.table).toContain("| 1 |  | 3 |");
  });
});

// ---------------------------------------------------------------------------
// 8. convertNotionMarkdown (orchestrator)
// ---------------------------------------------------------------------------
describe("convertNotionMarkdown", () => {
  it("applies callout + link + image conversions", () => {
    const fileMap = new Map([
      ["Target abcdef01234567890abcdef012345678.md", "Target.md"],
    ]);
    const input = [
      "# Title",
      "",
      "<aside>",
      "\u{1F4A1} Important tip here",
      "</aside>",
      "",
      "See [Target](Target%20abcdef01234567890abcdef012345678.md)",
      "",
      "![img](Page%20abcdef01234567890abcdef012345678/pic.png)",
    ].join("\n");

    const result = convertNotionMarkdown(input, fileMap);
    expect(result).toContain("> [!tip]");
    expect(result).toContain("[[Target]]");
    expect(result).toContain("![img](Page/pic.png)");
  });
});

// ---------------------------------------------------------------------------
// 9. cleanNotionPath
// ---------------------------------------------------------------------------
describe("cleanNotionPath", () => {
  it("cleans nested paths with Notion IDs", () => {
    const input =
      "My Page 3a4b5c6d7e8f90123456789012345678/Sub Page abcdef01234567890abcdef012345678/file.md";
    expect(cleanNotionPath(input)).toBe("My Page/Sub Page/file.md");
  });

  it("cleans a root-level file", () => {
    const input = "Note abcdef01234567890abcdef012345678.md";
    expect(cleanNotionPath(input)).toBe("Note.md");
  });

  it("returns already-clean paths unchanged", () => {
    expect(cleanNotionPath("docs/readme.md")).toBe("docs/readme.md");
  });

  it("handles paths where only some segments have IDs", () => {
    const input =
      "Workspace 3a4b5c6d7e8f90123456789012345678/images/photo.png";
    expect(cleanNotionPath(input)).toBe("Workspace/images/photo.png");
  });
});
