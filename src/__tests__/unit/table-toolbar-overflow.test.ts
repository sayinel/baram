import type { Translate } from "../../i18n/useTranslation";
import type { Editor } from "@tiptap/react";

// §5.5 — the toolbar ⋯ overflow menu item list (labels + order, no editor DOM).
import { describe, expect, it } from "vitest";

import { buildTableOverflowItems } from "../../components/toolbar/context-menu-table";
import en from "../../i18n/en.json";
import { t as translate } from "../../i18n/index";

// A stub editor: buildTableOverflowItems only wires actions; constructing the
// item list must not touch editor state, so a bare stub is enough.
const editor = {} as unknown as Editor;

const EN = en as Record<string, string>;
const t: Translate = (key, params) => translate(key, "en", params);

describe("buildTableOverflowItems", () => {
  it("lists header toggles, copies, and delete-table separated into 3 groups", () => {
    const items = buildTableOverflowItems(editor, t);
    const labels = items.map((i) => (i.separator ? "---" : i.label));
    // The subject is which commands appear and in what order, so the KEYS are written out —
    // but the expected strings are read from the catalogue, not copied. Spelling the English
    // words here would duplicate a value en.json owns (the labels used to be literals in the
    // builder, which is how the whole widget stayed untranslated), and it doubles as a
    // resolution check: a key missing from en.json makes `t()` echo the key while `EN[key]`
    // is `undefined`, so the comparison fails instead of quietly agreeing.
    expect(labels).toEqual([
      EN["tableMenu.toggleHeaderRow"],
      EN["tableMenu.toggleHeaderColumn"],
      "---",
      EN["tableMenu.copyAsMarkdown"],
      EN["tableMenu.copyAsHtml"],
      "---",
      EN["tableMenu.deleteTable"],
    ]);
  });

  it("gives every non-separator item a callable action", () => {
    const items = buildTableOverflowItems(editor, t);
    for (const item of items.filter((i) => !i.separator)) {
      expect(typeof item.action).toBe("function");
    }
  });
});
