// §388 plan 0117 Ruling 28 (spec 0067 §8) — a write refused once the collapse's shadow `apply` has
// begun pays the larger of its transaction and its walk, the amount `send`'s check asked for; a
// refusal before that apply pays its walk, or nothing. Real editors only: the bridge harness's
// fake has no syntax reveal plugin, so no expansion exists there and no collapse is applied.
import type { Editor } from "@tiptap/core";

import { AllSelection, EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginEditorHandle } from "../../plugin-host-registry";

import {
  dropAnchors,
  locateAnchor,
} from "../../../extensions/plugins/selection-anchors";
import { getSyntaxRevealExpanded } from "../../../extensions/plugins/syntax-reveal";
import { realEditor, select } from "../../__tests__/real-editor";
import { createEditorRequestHandler } from "../host-editor-bridge";

const OWNER = "acme.notes";
afterEach(() => dropAnchors(OWNER));

// "a bold b and more": 17 characters of text from position 1, 19 positions in all, 23 with the
// bold expanded (its `**` · `**` become text). The floor of 24 is every write's transaction.
const SOURCE = "a **bold** b and more\n";
const floor = 24;
const FRONTMATTER = "---\na: b\n---"; // 12 — refused below the document's start

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "written",
    (err: { code?: string }) => err.code,
  );

function bridge(editor: Editor, burst: number, writeFloor = floor) {
  return createEditorRequestHandler({
    budget: { burst, refillPerSecond: 0, writeFloor },
    capabilities: ["editor"] as never,
    editor: () => editor as unknown as PluginEditorHandle,
    pluginId: OWNER,
    stage: async () => {},
    surfaceBlocked: () => null,
  });
}

/** Expand the bold: a caret inside it, as the user's click puts it there. */
function expandBold(editor: Editor) {
  editor.commands.setTextSelection(5);
  expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
  expect(editor.state.doc.content.size).toBe(23);
}

/**
 * Exactly `n` tokens are left: an `n`-position read fits, and a one-position read after it does
 * not. The caret leaves the bold first: a selection that moves out of an expansion collapses it,
 * and a range selected over the expanded text would be read in collapsed positions.
 */
async function expectLeft(
  editor: Editor,
  handler: ReturnType<typeof bridge>,
  n: number,
  away = 13, // "and|" in SOURCE
) {
  select(editor, away);
  expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
  select(editor, 1, 1 + n);
  expect(editor.state.selection.to - editor.state.selection.from).toBe(n);
  await handler({ kind: "editor_get_selection" });
  select(editor, 1, 2);
  await expect(handler({ kind: "editor_get_selection" })).rejects.toMatchObject(
    { code: "budget" },
  );
}

describe("the collapse charge (plan 0117 Ruling 28)", () => {
  it("a write with no ref refused after the collapse pays its payload and the transaction", async () => {
    // The payload (12), then `send`'s check and the refusal: the larger of the transaction (24)
    // and the caret's walk (0). Charged the walk alone, 29 would be left.
    const { editor } = realEditor(SOURCE);
    const handler = bridge(editor, 12 + floor + 5);
    expandBold(editor);
    const apply = vi.spyOn(EditorState.prototype, "apply");
    expect(
      await codeOf(
        handler({ kind: "editor_insert_markdown", markdown: FRONTMATTER }),
      ),
    ).toBe("cannot-insert-here");
    expect(apply).toHaveBeenCalledTimes(1); // the shadow apply; nothing was sent
    apply.mockRestore();
    await expectLeft(editor, handler, 5);
    editor.destroy();
  });

  it("the same write with nothing expanded pays its payload and walk only (the positive pair)", async () => {
    // The same budget: `send`'s check asks for the transaction, but the refusal pays the walk
    // (0), leaving 24 + 5. `getMarkdown` (19) then leaves 10. Charged the transaction, 5 would
    // be left and `getMarkdown` refused.
    const { editor } = realEditor(SOURCE);
    const handler = bridge(editor, 12 + floor + 5);
    select(editor, 13); // "and|"
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    const apply = vi.spyOn(EditorState.prototype, "apply");
    expect(
      await codeOf(
        handler({ kind: "editor_insert_markdown", markdown: FRONTMATTER }),
      ),
    ).toBe("cannot-insert-here");
    expect(apply).not.toHaveBeenCalled();
    apply.mockRestore();
    await handler({ kind: "editor_get_markdown" });
    await expectLeft(editor, handler, 10);
    editor.destroy();
  });

  it("a write with no ref pays its walk when that is larger than the transaction — the document shrank during the parse", async () => {
    // Select all on "alpha" ("ph" bold) · five rules · "omega": 19 positions, walked when called.
    // During the parse the user deletes the rules (14 — they hold no text, so the text is as
    // read), turns "omega" into "Qmega" (refused for the range after the walk) and clicks into
    // the bold (18). Floor 8, so the transaction is the live document, 18. The refusal comes
    // after the collapse, so it pays the larger, 19: from 1 + 19 + 7, 7 are left — 8 if it
    // paid the transaction.
    const { editor } = realEditor(
      "al**ph**a\n\n" + "---\n\n".repeat(5) + "omega\n",
    );
    const handler = bridge(editor, 1 + 19 + 7, 8);
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
    expect(editor.state.doc.content.size).toBe(19);
    const pending = codeOf(
      handler({ kind: "editor_insert_markdown", markdown: "x" }),
    );
    const rules: number[] = [];
    editor.state.doc.forEach((node, pos) => {
      if (node.type.name === "horizontalRule") rules.push(pos);
    });
    expect(rules).toHaveLength(5);
    editor.view.dispatch(editor.state.tr.delete(rules[0]!, rules[4]! + 1));
    expect(editor.state.doc.textBetween(0, 14, "\n")).toBe("alpha\nomega");
    editor.view.dispatch(editor.state.tr.insertText("Q", 8, 9));
    editor.commands.setTextSelection(4); // "p|h"
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    expect(editor.state.doc.content.size).toBe(18);
    expect(await pending).toBe("ref-range-changed");
    await expectLeft(editor, handler, 7, 10);
    editor.destroy();
  });

  /**
   * Read "all" (19), add a paragraph (25 positions), expand the bold (29). The "all" ref now maps
   * to [0, 23] and is refused from its positions alone, after the collapse's shadow `apply`. The
   * same ref with nothing expanded is refused before any apply and costs nothing — the walk
   * file's "a range refused from its positions alone" row.
   */
  async function staleAllRef(burst: number) {
    const { editor } = realEditor(SOURCE);
    const handler = bridge(editor, burst);
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    const { ref } = (await handler({ kind: "editor_get_selection" })) as {
      ref: string;
    };
    const { paragraph } = editor.schema.nodes;
    editor.view.dispatch(
      editor.state.tr.insert(
        editor.state.doc.content.size,
        paragraph!.create(null, editor.schema.text("more")),
      ),
    );
    editor.commands.setTextSelection(5);
    expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();
    expect(editor.state.doc.content.size).toBe(29);
    // The walk: the range in the live document, short of its end.
    expect(locateAnchor(OWNER, ref, editor.state.doc)).toEqual({
      from: 0,
      ok: true,
      to: 23,
    });
    return { editor, handler, ref };
  }

  it.each([
    { kind: "editor_insert_markdown", markdown: "" },
    { kind: "editor_insert_text", text: "" },
  ] as const)(
    "$kind with a stale ref, refused from its positions after the collapse, pays the transaction — until the budget refuses before the apply",
    async (write) => {
      // After the read, two tries' worth (the transaction, 29 — larger than the walk, 23) and 10.
      const { editor, handler, ref } = await staleAllRef(19 + 29 * 2 + 10);
      const apply = vi.spyOn(EditorState.prototype, "apply");
      const codes: Array<string | undefined> = [];
      for (let i = 0; i < 4; i++)
        codes.push(await codeOf(handler({ ...write, replace: ref })));
      // Paid nothing, all four would be refused for the range, each after an apply.
      expect(codes).toEqual([
        "ref-range-changed",
        "ref-range-changed",
        "budget",
        "budget",
      ]);
      expect(apply).toHaveBeenCalledTimes(2); // the count stops with the budget refusals
      apply.mockRestore();
      await expectLeft(editor, handler, 10);
      editor.destroy();
    },
  );
});
