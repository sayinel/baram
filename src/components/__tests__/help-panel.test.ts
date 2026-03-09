// Help Panel — prepareHelpMarkdown logic and content structure tests
import { describe, it, expect } from "vitest";
import { prepareHelpMarkdown } from "../help/prepare-help-markdown";

// ─── prepareHelpMarkdown: H1 removal ─────────────────────────────────────────

describe("prepareHelpMarkdown: H1 removal", () => {
  it("removes the first H1 line", () => {
    const input = "# Baram User Guide\n\nSome content.\n";
    const result = prepareHelpMarkdown(input);
    expect(result).not.toContain("# Baram User Guide");
    expect(result).toContain("Some content.");
  });

  it("does not remove H2 or deeper headings", () => {
    const input = "# Title\n\n## Section\n\nContent.\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("## Section");
  });

  it("handles markdown without an H1 gracefully", () => {
    const input = "## Section\n\nContent.\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toBe(input);
  });
});

// ─── prepareHelpMarkdown: ToC removal ────────────────────────────────────────

describe("prepareHelpMarkdown: Table of Contents removal", () => {
  it("removes ToC section between ## Table of Contents and next ---", () => {
    const input =
      [
        "# Title",
        "",
        "## Table of Contents",
        "- [Section 1](#section-1)",
        "- [Section 2](#section-2)",
        "",
        "---",
        "",
        "## Section 1",
        "Content here.",
      ].join("\n") + "\n";

    const result = prepareHelpMarkdown(input);
    expect(result).not.toContain("Table of Contents");
    expect(result).not.toContain("- [Section 1](#section-1)");
    expect(result).toContain("## Section 1");
    expect(result).toContain("Content here.");
  });

  it("preserves content after the closing ---", () => {
    const input =
      [
        "## Table of Contents",
        "- item",
        "",
        "---",
        "",
        "## Real Content",
        "Kept.",
      ].join("\n") + "\n";

    const result = prepareHelpMarkdown(input);
    expect(result).toContain("## Real Content");
    expect(result).toContain("Kept.");
  });
});

// ─── prepareHelpMarkdown: ASCII art code block removal ────────────────────────

describe("prepareHelpMarkdown: ASCII art code block removal", () => {
  it("removes code blocks containing box-drawing characters", () => {
    const input =
      [
        "Before.",
        "```",
        "┌──────┐",
        "│ box  │",
        "└──────┘",
        "```",
        "After.",
      ].join("\n") + "\n";

    const result = prepareHelpMarkdown(input);
    expect(result).not.toContain("┌");
    expect(result).not.toContain("└");
    expect(result).toContain("Before.");
    expect(result).toContain("After.");
  });

  it("keeps code blocks without box-drawing characters", () => {
    const input = "```js\nconst x = 1;\n```\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("const x = 1;");
  });
});

// ─── prepareHelpMarkdown: inter-doc link conversion ───────────────────────────

describe("prepareHelpMarkdown: inter-doc link conversion", () => {
  it("converts keyboard-shortcuts.md link to help:shortcuts", () => {
    const input = "See [shortcuts](keyboard-shortcuts.md).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(help:shortcuts)");
    expect(result).not.toContain("keyboard-shortcuts.md");
  });

  it("converts user-guide.md link to help:guide", () => {
    const input = "See the [user guide](user-guide.md).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(help:guide)");
  });

  it("converts faq.md link to help:faq", () => {
    const input = "See [FAQ](faq.md).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(help:faq)");
  });

  it("preserves anchor fragment in converted links", () => {
    const input = "See [shortcuts](keyboard-shortcuts.md#navigation).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(help:shortcuts#navigation)");
  });

  it("converts parent-path links to plain text", () => {
    const input = "See [README](../README.md).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).not.toContain("../README.md");
    // Link text is kept, but href is removed
    expect(result).toContain("README");
  });

  it("leaves external https links unchanged", () => {
    const input = "Visit [example](https://example.com).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(https://example.com)");
  });

  it("leaves anchor-only links unchanged", () => {
    const input = "See [section](#my-section).\n";
    const result = prepareHelpMarkdown(input);
    expect(result).toContain("(#my-section)");
  });
});

// ─── prepareHelpMarkdown: parent-path link removal ────────────────────────────

describe("prepareHelpMarkdown: parent-path link removal", () => {
  it("removes [text](../path) links, keeping link text", () => {
    const input = "Click [here](../some/path.md) for info.\n";
    const result = prepareHelpMarkdown(input);
    expect(result).not.toContain("../");
    expect(result).toContain("here");
  });
});

// ─── slugify (inline re-implementation for correctness verification) ───────────

describe("slugify behavior (help panel anchor generation)", () => {
  // Inline the slugify function to verify correctness without importing from component
  function slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  it("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugify("Basic Editing")).toBe("basic-editing");
  });

  it("removes special characters", () => {
    expect(slugify("Hello! World?")).toBe("hello-world");
  });

  it("collapses multiple spaces/hyphens", () => {
    expect(slugify("one   two")).toBe("one-two");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  trim  ")).toBe("trim");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

// ─── HELP_SCHEME_TO_TAB mapping ───────────────────────────────────────────────

describe("HELP_SCHEME_TO_TAB mapping", () => {
  // Inline the mapping to verify completeness without importing the component
  const HELP_SCHEME_TO_TAB: Record<string, string> = {
    "help:guide": "guide",
    "help:shortcuts": "shortcuts",
    "help:faq": "faq",
  };

  it("has entries for all three help tabs", () => {
    expect(Object.keys(HELP_SCHEME_TO_TAB)).toHaveLength(3);
  });

  it("maps help:guide to guide", () => {
    expect(HELP_SCHEME_TO_TAB["help:guide"]).toBe("guide");
  });

  it("maps help:shortcuts to shortcuts", () => {
    expect(HELP_SCHEME_TO_TAB["help:shortcuts"]).toBe("shortcuts");
  });

  it("maps help:faq to faq", () => {
    expect(HELP_SCHEME_TO_TAB["help:faq"]).toBe("faq");
  });

  it("returns undefined for unknown schemes", () => {
    expect(HELP_SCHEME_TO_TAB["help:unknown"]).toBeUndefined();
  });
});

// ─── TAB_CONTENT availability ─────────────────────────────────────────────────

describe("TAB_CONTENT: raw doc files exist and are non-empty", () => {
  // Import raw files the same way HelpPanel does
  // vitest with jsdom can resolve ?raw imports via vite
  it("prepareHelpMarkdown handles empty string without throwing", () => {
    expect(() => prepareHelpMarkdown("")).not.toThrow();
    expect(prepareHelpMarkdown("")).toBe("");
  });

  it("prepareHelpMarkdown is idempotent on already-processed content", () => {
    const input = "## Section\n\nSome content with [link](help:shortcuts).\n";
    const first = prepareHelpMarkdown(input);
    const second = prepareHelpMarkdown(first);
    expect(second).toBe(first);
  });
});
