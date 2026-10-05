// §388 plan 0117 Rulings 26 · 27 (spec 0067 §8) — a write refused after its range was walked pays
// the walked length; one that lands pays its payload and transaction only. Before any walk the
// meter is asked for what the write could still owe: in `send`, the larger of the transaction and
// the walk; before the implicit anchor of an `insertMarkdown` with no ref, its payload and the
// walk. Walks are counted as real `textBetween` calls on the live document node, as the Ruling 24
// rows in `host-editor-bridge.insert.test.ts` count them. A refusal after a collapse is in
// `host-editor-bridge.collapse.test.ts`.
import { AllSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { PluginEditorHandle } from "../../plugin-host-registry";

import { dropAnchors } from "../../../extensions/plugins/selection-anchors";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { realEditor, select } from "../../__tests__/real-editor";
import { createEditorRequestHandler } from "../host-editor-bridge";
import { harness, schema } from "./editor-bridge-harness";

const OWNER = "acme.notes"; // `harness` issues every ref as this owner
afterEach(() => dropAnchors(OWNER));

const floor = 16;
const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "written",
    (err: { code?: string }) => err.code,
  );

/**
 * Exactly `n` tokens are left: an `n`-position read fits, and a one-position read after it does
 * not. `getSelection` charges `to - from`; the document's first textblock must hold `n`
 * characters.
 */
async function expectLeft(run: ReturnType<typeof harness>, n: number) {
  run.editor.select(1, 1 + n);
  await run.handler({ kind: "editor_get_selection" });
  run.editor.select(1, 2);
  await expect(
    run.handler({ kind: "editor_get_selection" }),
  ).rejects.toMatchObject({ code: "budget" });
}

describe("the walk charge (plan 0117 Ruling 26)", () => {
  it("a stale ref's refused writes each pay the walked range, until the budget refuses before the walk", async () => {
    // A real editor: the ref must follow the plugin's own edit, which the fake editor cannot.
    const { editor } = realEditor("alpha\n\nomega\n"); // 14 positions
    const handler = createEditorRequestHandler({
      // The "all" read (14) and the plugin's own insert (the floor, 16), then 46 left: one
      // transaction (16) and two walks of the edited document (15) above it.
      budget: { burst: 14 + floor + 46, refillPerSecond: 0, writeFloor: floor },
      capabilities: ["editor"] as never,
      editor: () => editor as unknown as PluginEditorHandle,
      pluginId: OWNER,
      stage: async () => {},
      surfaceBlocked: () => null,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    const { ref } = (await handler({ kind: "editor_get_selection" })) as {
      ref: string;
    };
    select(editor, 1);
    await handler({ kind: "editor_insert_text", text: "Z" }); // the "all" ref now maps to [0, 15]
    const walk = vi.spyOn(editor.state.doc, "textBetween");
    const codes: Array<string | undefined> = [];
    for (let i = 0; i < 5; i++) {
      codes.push(
        await codeOf(
          handler({
            kind: "editor_insert_markdown",
            markdown: "",
            replace: ref,
          }),
        ),
      );
    }
    // 46 → 31 → 16 → 1, each try paying 15; at 1 the check (16) refuses before the walk. Paid
    // nothing, every try would be refused for the range; paid the transaction (16), only two.
    expect(codes).toEqual([
      "ref-range-changed",
      "ref-range-changed",
      "ref-range-changed",
      "budget",
      "budget",
    ]);
    expect(walk).toHaveBeenCalledTimes(3);
    expect(walk.mock.calls[0]?.slice(0, 2)).toEqual([0, 15]);
    // Exactly 1 left: a one-position read fits, a second does not.
    select(editor, 1, 2);
    await handler({ kind: "editor_get_selection" });
    await expect(
      handler({ kind: "editor_get_selection" }),
    ).rejects.toMatchObject({ code: "budget" });
    editor.destroy();
  });

  // "alpha beta gamma delta" in a heading: 22 positions of text from position 1, 24 in all —
  // above the floor, so a write's transaction here is 24.
  const HEADING = "# alpha beta gamma delta\n";

  it.each([
    {
      code: "ref-unknown",
      read: false,
      refFor: () => "0".repeat(32),
    },
    {
      code: "ref-other-document",
      read: true,
      // The same text as a new document node, installed with no transaction.
      install: true,
      refFor: (ref: string) => ref,
    },
  ])(
    "$code is refused before any walk and leaves the meter as it was",
    async ({ code, install, read, refFor }) => {
      const run = harness(HEADING, ["editor"], {
        budget: {
          burst: (read ? 5 : 0) + floor,
          refillPerSecond: 0,
          writeFloor: floor,
        },
      });
      let ref = "";
      if (read) {
        run.editor.select(1, 6); // "alpha", 5
        ref = (
          (await run.handler({ kind: "editor_get_selection" })) as {
            ref: string;
          }
        ).ref;
      }
      if (install)
        run.editor.installDocument(markdownToProsemirror(HEADING, schema));
      const walk = vi.spyOn(run.editor.handle.state.doc, "textBetween");
      expect(
        await codeOf(
          run.handler({
            kind: "editor_insert_markdown",
            markdown: "",
            replace: refFor(ref),
          }),
        ),
      ).toBe(code);
      expect(walk).not.toHaveBeenCalled();
      await expectLeft(run, floor);
    },
  );

  it("a range refused from its positions alone — an all ref after the user added a block — costs nothing", async () => {
    // A real editor, so the ref follows the user's edit. Its range no longer reaches the end,
    // which `verifyAnchor` sees before it reads any text.
    const { editor } = realEditor("alpha\n\nomega\n"); // 14 positions, 20 once "more" is added
    const handler = createEditorRequestHandler({
      // The "all" read (14), then the check's transaction on the grown document (20).
      budget: { burst: 14 + 20, refillPerSecond: 0, writeFloor: floor },
      capabilities: ["editor"] as never,
      editor: () => editor as unknown as PluginEditorHandle,
      pluginId: OWNER,
      stage: async () => {},
      surfaceBlocked: () => null,
    });
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
    const walk = vi.spyOn(editor.state.doc, "textBetween");
    expect(
      await codeOf(
        handler({ kind: "editor_insert_markdown", markdown: "", replace: ref }),
      ),
    ).toBe("ref-range-changed");
    expect(walk).not.toHaveBeenCalled();
    // 20 left, as before the write: `getMarkdown` (20) fits, and a one-position read after it
    // does not. Charged the range (14), the write would have left 6.
    await handler({ kind: "editor_get_markdown" });
    select(editor, 1, 2);
    await expect(
      handler({ kind: "editor_get_selection" }),
    ).rejects.toMatchObject({ code: "budget" });
    editor.destroy();
  });

  it("a refusal after the walk pays the walked range (the positive pair)", async () => {
    // Blocks into a heading: refused by the placement rules, after the shadow check walked
    // "alpha". Read 5, payload 4, then 24 left for the check (the transaction); the refusal
    // leaves 24 − 5.
    const run = harness(HEADING, ["editor"], {
      budget: { burst: 5 + 4 + 24, refillPerSecond: 0, writeFloor: floor },
    });
    run.editor.select(1, 6);
    const { ref } = (await run.handler({ kind: "editor_get_selection" })) as {
      ref: string;
    };
    const walk = vi.spyOn(run.editor.handle.state.doc, "textBetween");
    expect(
      await codeOf(
        run.handler({
          kind: "editor_insert_markdown",
          markdown: "a\n\nb",
          replace: ref,
        }),
      ),
    ).toBe("cannot-insert-here");
    expect(walk).toHaveBeenCalledTimes(1);
    await expectLeft(run, 24 - 5);
  });

  it("a write with no ref, refused after its parse, pays the selection it walked when called", async () => {
    // A real editor, so the implicit anchor follows the user's typing during the parse.
    const { editor } = realEditor("alpha\n\nomega\n"); // 14 positions
    const handler = createEditorRequestHandler({
      // The payload (1), then the check's transaction (16) and 4 more.
      budget: { burst: 1 + floor + 4, refillPerSecond: 0, writeFloor: floor },
      capabilities: ["editor"] as never,
      editor: () => editor as unknown as PluginEditorHandle,
      pluginId: OWNER,
      stage: async () => {},
      surfaceBlocked: () => null,
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    const pending = codeOf(
      handler({ kind: "editor_insert_markdown", markdown: "x" }),
    );
    editor.view.dispatch(editor.state.tr.insertText("Q", 3)); // the user types inside
    expect(await pending).toBe("ref-range-changed");
    // 21 − 1 − 14 leaves 6: the walk is the 14 positions selected when the write was called,
    // not the 15 its anchor covers after the typing.
    select(editor, 1, 7); // "alQpha"
    await handler({ kind: "editor_get_selection" });
    select(editor, 1, 2);
    await expect(
      handler({ kind: "editor_get_selection" }),
    ).rejects.toMatchObject({ code: "budget" });
    editor.destroy();
  });

  it("with no ref, a selection write is refused before it walks unless the budget covers its payload and the selection (Ruling 27)", async () => {
    // Select all on "alpha omega" (13 positions, floor 16); `getMarkdown` (13) spends first. When
    // called, the check asks for the payload (1) and the walk (13), not the transaction.
    const run = async (left: number) => {
      const r = harness("alpha omega\n", ["editor"], {
        budget: { burst: 13 + left, refillPerSecond: 0, writeFloor: floor },
      });
      await r.handler({ kind: "editor_get_markdown" });
      r.editor.selectAll();
      const walks = vi.spyOn(r.editor.handle.state.doc, "textBetween");
      const code = await codeOf(
        r.handler({ kind: "editor_insert_markdown", markdown: "x" }),
      );
      return { ...r, code, walks: walks.mock.calls.length };
    };
    const short = await run(13);
    expect([short.code, short.walks]).toEqual(["budget", 0]);
    expect(short.editor.dispatched).toEqual([]);
    // 14 is enough to walk — asked for the transaction too (17), it would not be. `send` then
    // asks for the transaction (16) with 13 left, and the refusal pays the walk: nothing left.
    const exact = await run(14);
    expect([exact.code, exact.walks]).toEqual(["budget", 1]);
    expect(exact.editor.dispatched).toEqual([]);
    exact.editor.select(1, 2);
    await expect(
      exact.handler({ kind: "editor_get_selection" }),
    ).rejects.toMatchObject({ code: "budget" });
    const covered = await run(17); // the payload and the transaction
    expect(covered.code).toBe("written");
    expect(covered.editor.markdown()).toBe("x\n");
  });

  it("with no ref, a caret write is asked only for its payload when called, so the refill during the parse can cover its transaction (Ruling 27)", async () => {
    // Floor 8 under "alpha omega" (13): the transaction is 13. `getMarkdown` leaves 13, short of
    // payload and transaction (14) by the second of refill (1) the parse takes.
    const write = async (wait: number) => {
      let t = 0;
      const r = harness("alpha omega\n", ["editor"], {
        budget: { burst: 13 + 13, refillPerSecond: 1, writeFloor: 8 },
        now: () => t,
      });
      await r.handler({ kind: "editor_get_markdown" });
      r.editor.select(6, 6); // "alpha|"
      const pending = codeOf(
        r.handler({ kind: "editor_insert_markdown", markdown: "x" }),
      );
      t += wait;
      return { code: await pending, markdown: r.editor.markdown() };
    };
    expect(await write(1000)).toEqual({
      code: "written",
      markdown: "alphax omega\n",
    });
    // Without the refill `send` finds 12, short of the transaction: the refill is what lands it.
    expect(await write(0)).toEqual({
      code: "budget",
      markdown: "alpha omega\n",
    });
  });

  it("with no ref, the check counts the payload still due, so the payload cannot leave the walk unpaid", async () => {
    // Floor 8 under "alpha omega" (13): the transaction and the "all" walk are both 13. The
    // check runs before the payload is charged; asked for 13 alone it would pass with 13 left,
    // the payload (1) would leave 12, and the walk's charge (13) would then be refused.
    const run = (left: number) =>
      harness("alpha omega\n", ["editor"], {
        budget: { burst: 13 + left, refillPerSecond: 0, writeFloor: 8 },
      });
    const short = run(13);
    await short.handler({ kind: "editor_get_markdown" });
    short.editor.selectAll();
    const none = vi.spyOn(short.editor.handle.state.doc, "textBetween");
    expect(
      await codeOf(
        short.handler({ kind: "editor_insert_markdown", markdown: "x" }),
      ),
    ).toBe("budget");
    expect(none).not.toHaveBeenCalled();
    const enough = run(14);
    await enough.handler({ kind: "editor_get_markdown" });
    enough.editor.selectAll();
    const walks = vi.spyOn(enough.editor.handle.state.doc, "textBetween");
    expect(
      await codeOf(
        enough.handler({ kind: "editor_insert_markdown", markdown: "x" }),
      ),
    ).toBe("written");
    expect(walks).toHaveBeenCalled();
  });

  it("with no ref, a document as large as the burst still takes a write when the refill during the parse covers its payload", async () => {
    // Burst 13 = the document (floor 8): payload and walk cannot both fit, so the check asks
    // for a full bucket. The payload (1) is charged before the parse; a second of refill during
    // it restores the bucket, and the write lands, as it did before the walk was priced.
    let t = 0;
    const run = harness("alpha omega\n", ["editor"], {
      budget: { burst: 13, refillPerSecond: 1, writeFloor: 8 },
      now: () => t,
    });
    run.editor.selectAll();
    const pending = codeOf(
      run.handler({ kind: "editor_insert_markdown", markdown: "x" }),
    );
    t += 1000;
    expect(await pending).toBe("written");
    expect(run.editor.markdown()).toBe("x\n");
  });

  it("a write that lands pays its payload and transaction, and nothing for its walk", async () => {
    // Read "alpha" (5); the write pays "**B**" (5) and the floor (16), leaving 7 — which a walk
    // charge of 5 on top would cut to 2.
    const run = harness("alpha omega\n", ["editor"], {
      budget: {
        burst: 5 + 5 + floor + 7,
        refillPerSecond: 0,
        writeFloor: floor,
      },
    });
    run.editor.select(1, 6);
    const { ref } = (await run.handler({ kind: "editor_get_selection" })) as {
      ref: string;
    };
    await run.handler({
      kind: "editor_insert_markdown",
      markdown: "**B**",
      replace: ref,
    });
    expect(run.editor.markdown()).toBe("**B** omega\n");
    await expectLeft(run, 7); // "B omega": 7 positions of text
  });

  it.each([
    { burst: 26, label: "half the burst", refill: 0, wait: 0 },
    // Read, then refill back to exactly the document's size, one short of the burst.
    { burst: 14, label: "one short of the burst", refill: 12, wait: 1000 },
  ])(
    "the check asks for the larger of transaction and walk, not their sum — an all ref at $label",
    async ({ burst, refill, wait }) => {
      // Floor 8 under a 13-position document: the charge on success is 13 and the "all" walk is
      // 13. The write finds 13 left, enough for either; the sum — 26, or the whole burst where
      // that is less — would refuse it.
      let t = 0;
      const run = harness("alpha omega\n", ["editor"], {
        budget: { burst, refillPerSecond: refill, writeFloor: 8 },
        now: () => t,
      });
      run.editor.selectAll();
      const { ref } = (await run.handler({ kind: "editor_get_selection" })) as {
        ref: string;
      };
      t += wait;
      expect(
        await codeOf(
          run.handler({ kind: "editor_insert_text", text: "x", replace: ref }),
        ),
      ).toBe("written");
      expect(run.editor.handle.state.doc.textContent).toBe("x");
    },
  );
});
