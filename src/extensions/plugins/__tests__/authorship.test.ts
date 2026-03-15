// §11.7 Authorship ProseMirror Plugin — decoration tests
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { AuthorshipTracker } from "../../../utils/authorship-tracker";
import { authorshipPluginKey, buildAuthorshipDecorations } from "../authorship";

// Minimal schema for testing
const schema = new Schema({
  marks: {},
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
    },
    text: { group: "inline" },
  },
});

function makeDoc(...paragraphs: string[]) {
  const nodes = paragraphs.map((text) =>
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  );
  return schema.node("doc", null, nodes);
}

describe("AuthorshipPlugin", () => {
  it("creates decoration for ai-generated segments", () => {
    const tracker = new AuthorshipTracker();
    tracker.recordAIGenerated(1, 10, {
      action: "ghost-text",
      model: "sonnet",
      provider: "claude",
    });

    const doc = makeDoc("Hello world, this is test text.");
    const decos = buildAuthorshipDecorations(doc, tracker, true);
    const found = decos.find(0, doc.content.size);

    expect(found).toHaveLength(1);
    // Check the decoration spec has the correct CSS class
    const spec = (found[0] as unknown as { type: { attrs: { class: string } } })
      .type.attrs;
    expect(spec.class).toContain("authorship-ai-generated");
  });

  it("creates decoration for ai-modified segments", () => {
    const tracker = new AuthorshipTracker();
    tracker.recordAIModified(1, 10, {
      action: "inline-edit",
      model: "gpt-4o",
      provider: "openai",
    });

    const doc = makeDoc("Hello world, this is test text.");
    const decos = buildAuthorshipDecorations(doc, tracker, true);
    const found = decos.find(0, doc.content.size);

    expect(found).toHaveLength(1);
    const spec = (found[0] as unknown as { type: { attrs: { class: string } } })
      .type.attrs;
    expect(spec.class).toContain("authorship-ai-modified");
  });

  it("shows no decorations when disabled", () => {
    const tracker = new AuthorshipTracker();
    tracker.recordAIGenerated(1, 10, {
      action: "ghost-text",
      model: "sonnet",
      provider: "claude",
    });

    const doc = makeDoc("Hello world, this is test text.");
    const decos = buildAuthorshipDecorations(doc, tracker, false);
    const found = decos.find(0, doc.content.size);

    expect(found).toHaveLength(0);
  });

  it("has a valid plugin key", () => {
    expect(authorshipPluginKey).toBeDefined();
    expect((authorshipPluginKey as unknown as { key: string }).key).toContain(
      "authorship",
    );
  });
});
