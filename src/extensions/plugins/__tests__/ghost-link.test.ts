// §11.5.2 Ghost Link ProseMirror Plugin — tests
import { Schema } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeGhostLinkDecorations,
  GHOST_LINK_CSS_CLASS,
  ghostLinkPluginKey,
  MAX_SUGGESTIONS_PER_PARAGRAPH,
  MIN_PARAGRAPH_LENGTH,
  recordSuggestionTime,
  resetCooldown,
  shouldThrottle,
  SUGGESTION_COOLDOWN_MS,
} from "../ghost-link";

// ── Minimal schema ────────────────────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
    },
    text: { group: "inline" },
    wikilink: {
      attrs: {
        blockId: { default: null },
        display: { default: null },
        heading: { default: null },
        target: { default: "" },
      },
      atom: true,
      group: "inline",
      inline: true,
    },
  },
  marks: {},
});

// Helper: build a doc with paragraphs
function makeDoc(...paragraphs: string[]) {
  const nodes = paragraphs.map((text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  );
  return schema.node("doc", null, nodes);
}

// ── Plugin Key ────────────────────────────────────────────────────────

describe("§11.5.2 Ghost Link — plugin key", () => {
  it("ghostLinkPluginKey is defined and named correctly", () => {
    expect(ghostLinkPluginKey).toBeDefined();
    expect((ghostLinkPluginKey as unknown as { key: string }).key).toContain(
      "ghostLink",
    );
  });
});

// ── Constants ─────────────────────────────────────────────────────────

describe("§11.5.2 Ghost Link — constants", () => {
  it("has correct CSS class name", () => {
    expect(GHOST_LINK_CSS_CLASS).toBe("ghost-link");
  });

  it("maxSuggestionsPerParagraph is 3", () => {
    expect(MAX_SUGGESTIONS_PER_PARAGRAPH).toBe(3);
  });

  it("suggestion cooldown is 30 seconds", () => {
    expect(SUGGESTION_COOLDOWN_MS).toBe(30_000);
  });

  it("minimum paragraph length is 20", () => {
    expect(MIN_PARAGRAPH_LENGTH).toBe(20);
  });
});

// ── computeGhostLinkDecorations ───────────────────────────────────────

describe("§11.5.2 Ghost Link — computeGhostLinkDecorations", () => {
  const dictionary = new Set([
    "editor engine",
    "ProseMirror",
    "Rust",
    "Tiptap",
  ]);

  it("creates inline decorations for suggested links", () => {
    const doc = makeDoc(
      "Baram uses ProseMirror for editing with Tiptap framework.",
    );
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions.length).toBeGreaterThan(0);

    // Every suggestion should have correct structure
    for (const s of result.suggestions) {
      expect(s.from).toBeLessThan(s.to);
      expect(s.target).toBeTruthy();
    }
  });

  it("creates one decoration per suggestion", () => {
    const doc = makeDoc("Baram uses ProseMirror for editing purposes here.");
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions.length).toBeGreaterThan(0);

    const decoSet = result.decorationSet;
    const found = decoSet.find(0, doc.content.size);
    // One decoration per suggestion
    expect(found.length).toBe(result.suggestions.length);
  });

  it("suggestions contain target and display for data attributes", () => {
    const doc = makeDoc("Baram uses ProseMirror for editing purposes here.");
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions.length).toBeGreaterThan(0);

    for (const s of result.suggestions) {
      // These map to data-ghost-link, data-target, data-display in the decoration
      expect(s.target).toBeTruthy();
      expect(s.display).toBeTruthy();
    }
  });

  it("respects maxSuggestionsPerParagraph = 3", () => {
    // Build a paragraph with 5 potential matches
    const bigDict = new Set(["alpha", "beta", "delta", "epsilon", "gamma"]);
    const doc = makeDoc(
      "The alpha and beta with gamma and delta plus epsilon are here.",
    );
    const result = computeGhostLinkDecorations(doc, bigDict, new Set());
    expect(result.suggestions.length).toBeLessThanOrEqual(
      MAX_SUGGESTIONS_PER_PARAGRAPH,
    );
  });

  it("skips paragraphs shorter than MIN_PARAGRAPH_LENGTH", () => {
    const doc = makeDoc("Short ProseMirror."); // 18 chars < 20
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions).toHaveLength(0);
  });

  it("excludes dismissed suggestions", () => {
    const doc = makeDoc("Baram uses ProseMirror for editing purposes here.");
    const dismissed = new Set(["ProseMirror"]);
    const result = computeGhostLinkDecorations(doc, dictionary, dismissed);
    const targets = result.suggestions.map((s) => s.target);
    expect(targets).not.toContain("ProseMirror");
  });

  it("returns empty for paragraphs with no dictionary matches", () => {
    const doc = makeDoc("Hello world, this is a simple text.");
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions).toHaveLength(0);
  });

  it("returns empty for empty document", () => {
    const doc = makeDoc("");
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    expect(result.suggestions).toHaveLength(0);
  });

  it("handles multiple paragraphs independently", () => {
    const doc = makeDoc(
      "ProseMirror is used for editing in Baram editor.",
      "Tiptap wraps ProseMirror in a nice API layer.",
    );
    const result = computeGhostLinkDecorations(doc, dictionary, new Set());
    // Should find matches from both paragraphs
    const targets = result.suggestions.map((s) => s.target);
    expect(targets).toContain("ProseMirror");
    expect(targets).toContain("Tiptap");
  });
});

// ── Cooldown ──────────────────────────────────────────────────────────

describe("§11.5.2 Ghost Link — cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCooldown();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetCooldown();
  });

  it("is not throttled initially", () => {
    expect(shouldThrottle()).toBe(false);
  });

  it("is throttled immediately after recording suggestion time", () => {
    recordSuggestionTime();
    expect(shouldThrottle()).toBe(true);
  });

  it("is still throttled after 29 seconds", () => {
    recordSuggestionTime();
    vi.advanceTimersByTime(29_000);
    expect(shouldThrottle()).toBe(true);
  });

  it("is no longer throttled after 30 seconds", () => {
    recordSuggestionTime();
    vi.advanceTimersByTime(30_001);
    expect(shouldThrottle()).toBe(false);
  });
});
