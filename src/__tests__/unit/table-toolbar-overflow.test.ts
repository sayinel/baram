import type { Editor } from "@tiptap/react";

// §5.5 — the toolbar ⋯ overflow menu item list (labels + order, no editor DOM).
import { describe, expect, it } from "vitest";

import { buildTableOverflowItems } from "../../components/toolbar/context-menu-table";

// A stub editor: buildTableOverflowItems only wires actions; constructing the
// item list must not touch editor state, so a bare stub is enough.
const editor = {} as unknown as Editor;

describe("buildTableOverflowItems", () => {
  it("lists header toggles, copies, and delete-table separated into 3 groups", () => {
    const items = buildTableOverflowItems(editor);
    const labels = items.map((i) => (i.separator ? "---" : i.label));
    expect(labels).toEqual([
      "Toggle Header Row",
      "Toggle Header Column",
      "---",
      "Copy as Markdown",
      "Copy as HTML",
      "---",
      "Delete Table",
    ]);
  });

  it("gives every non-separator item a callable action", () => {
    const items = buildTableOverflowItems(editor);
    for (const item of items.filter((i) => !i.separator)) {
      expect(typeof item.action).toBe("function");
    }
  });
});
