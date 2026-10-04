// §388 spec 0067 §8 · §10 · §11-12 — the sandboxed tier's markdown insert, refs and coded
// refusals, on the bridge's fake editor. That fake has no anchor plugin, so a ref does not
// follow a transaction: these rows drive only flows with no transaction between the read and
// the write (see `editor-bridge-harness.ts`).
import { afterEach, describe, expect, it } from "vitest";

import {
  anchorCount,
  dropAnchors,
} from "../../../extensions/plugins/selection-anchors";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { everyEditorRequest, harness, schema } from "./editor-bridge-harness";

// The anchor table is module state; `harness` issues every ref as this owner.
afterEach(() => dropAnchors("acme.notes"));

describe("insertMarkdown (§388 spec 0067 §8)", () => {
  it("parses and inserts at the selection; the answer carries no document", async () => {
    const { editor, handler } = harness("alpha omega\n", ["editor"]);
    editor.select(7, 7); // "alpha " 1-7
    const answer = await handler({
      kind: "editor_insert_markdown",
      markdown: "**x**",
    });
    // The parser drops a trailing space, so "**x** " would not keep one (plan review m1).
    expect(editor.markdown()).toBe("alpha **x**omega\n");
    expect(answer).toBeUndefined();
  });

  it("getSelection answers a ref inline, also for a bare caret", async () => {
    const { editor, handler } = harness("alpha omega\n", ["editor"]);
    editor.select(3, 3);
    const answer = (await handler({ kind: "editor_get_selection" })) as {
      ref: string;
    };
    expect(answer).toMatchObject({ from: 3, staged: false, to: 3 });
    expect(answer.ref).toMatch(/^[0-9a-f]{32}$/u);
  });

  it("refuses with a code: readonly writes are not-permitted", async () => {
    const { editor, handler } = harness("alpha\n", ["editor:readonly"]);
    await expect(
      handler({ kind: "editor_insert_markdown", markdown: "x" }),
    ).rejects.toMatchObject({
      code: "not-permitted",
    });
    expect(editor.dispatched).toEqual([]);
  });

  // §11-12 — burst = 2 + floor, refill 0. A payload of 1 costs 1; a transaction costs the
  // floor (16 — every document here is smaller). So: accepted (1 + 16) leaves 1, and the next
  // insert's transaction is refused; refused after the parse (1) leaves 17, and the next
  // insert fits exactly.
  const floor = 16;
  const tight = {
    budget: { burst: 2 + floor, refillPerSecond: 0, writeFloor: floor },
  };

  it("an accepted insert pays the payload and the transaction", async () => {
    const { editor, handler } = harness("alpha omega\n", ["editor"], tight);
    editor.select(7, 7);
    await handler({ kind: "editor_insert_markdown", markdown: "x" });
    editor.select(7, 7);
    await expect(
      handler({ kind: "editor_insert_markdown", markdown: "x" }),
    ).rejects.toMatchObject({
      code: "budget",
    });
  });

  it("a refusal after the parse pays the payload only", async () => {
    const { editor, handler } = harness("alpha omega\n", ["editor"], tight);
    editor.select(7, 7);
    const pending = handler({ kind: "editor_insert_markdown", markdown: "x" });
    // No transaction: this fake has no anchor plugin, so the new document is not in the table.
    editor.installDocument(markdownToProsemirror("other\n", schema));
    await expect(pending).rejects.toMatchObject({ code: "ref-other-document" });
    editor.select(3, 3);
    await handler({ kind: "editor_insert_markdown", markdown: "x" });
    expect(editor.markdown()).toBe("otxher\n");
  });

  // Spec §8 — the surface gate comes first, before any charge. Sized like the rows above:
  // the burst is exactly payload + floor, so a blocked attempt that paid its payload would
  // leave the unblocked retry short of the transaction.
  it.each([
    { payload: 1, request: { kind: "editor_insert_markdown", markdown: "x" } },
    { payload: 4, request: { kind: "editor_set_markdown", markdown: "# b\n" } },
  ] as const)(
    "$request.kind refused at the surface gate is charged nothing",
    async ({ payload, request }) => {
      let blocked: null | string = "the document is open in source mode";
      const { handler } = harness("# a\n", ["editor"], {
        budget: {
          burst: payload + floor,
          refillPerSecond: 0,
          writeFloor: floor,
        },
        surfaceBlocked: () => blocked,
      });
      await expect(handler(request)).rejects.toMatchObject({
        code: "surface-blocked",
      });
      blocked = null;
      await expect(handler(request)).resolves.toBeUndefined();
    },
  );
});

describe("replace — a ref from getSelection (§388 spec 0067 §8)", () => {
  it.each([
    {
      expected: "alpha **B** omega\n",
      request: { kind: "editor_insert_markdown", markdown: "**B**" },
    },
    {
      expected: "alpha \\*\\*B\\*\\* omega\n",
      request: { kind: "editor_insert_text", text: "**B**" },
    },
  ] as const)(
    "$request.kind replaces exactly the range the ref was read from",
    async ({ expected, request }) => {
      const { editor, handler } = harness("alpha beta omega\n", ["editor"]);
      editor.select(7, 11); // "beta"
      const { ref } = (await handler({ kind: "editor_get_selection" })) as {
        ref: string;
      };
      // The caret moves away: without `replace` the write would land here instead.
      editor.select(1, 1);
      await handler({ ...request, replace: ref });
      expect(editor.markdown()).toBe(expected);
    },
  );

  it("records a ref only for a plugin that can write (spec 0067 §7.1)", async () => {
    // The ref an `editor:readonly` plugin gets names nothing, so it fills no slot in the
    // anchor table; a writer's does.
    const reader = harness("alpha\n", ["editor:readonly"]);
    reader.editor.select(1, 3);
    await reader.handler({ kind: "editor_get_selection" });
    expect(anchorCount("acme.notes")).toBe(0);

    const writer = harness("alpha\n", ["editor"]);
    writer.editor.select(1, 3);
    await writer.handler({ kind: "editor_get_selection" });
    expect(anchorCount("acme.notes")).toBe(1);
  });

  it.each([
    { request: { kind: "editor_insert_markdown", markdown: "x" } },
    { request: { kind: "editor_insert_text", text: "x" } },
  ] as const)(
    "$request.kind refuses a ref this plugin never read with ref-unknown",
    async ({ request }) => {
      const { editor, handler } = harness("alpha\n", ["editor"]);
      await expect(
        handler({ ...request, replace: "0".repeat(32) }),
      ).rejects.toMatchObject({ code: "ref-unknown" });
      expect(editor.dispatched).toEqual([]);
    },
  );
});

// Spec §10 — every refusal the bridge itself raises carries a code. The budget and ref rows
// above cover `budget` and the ref codes; these cover the gates in front of every request.
describe("coded refusals (§388 spec 0067 §10)", () => {
  it("not-permitted without an editor grant, on every request", async () => {
    const { handler } = harness("alpha\n", ["files"]);
    for (const request of everyEditorRequest()) {
      await expect(handler(request), request.kind).rejects.toMatchObject({
        code: "not-permitted",
        message: expect.stringMatching(/requires one of "editor"/u),
      });
    }
  });

  it("surface-blocked and no-editor, on every request", async () => {
    const blocked = harness("alpha\n", ["editor"], {
      surfaceBlocked: () => "the document is open in source mode",
    });
    const closed = harness("alpha\n", ["editor"], { editor: () => null });
    for (const request of everyEditorRequest()) {
      await expect(
        blocked.handler(request),
        request.kind,
      ).rejects.toMatchObject({ code: "surface-blocked" });
      await expect(closed.handler(request), request.kind).rejects.toMatchObject(
        {
          code: "no-editor",
        },
      );
    }
  });

  it("document-changed when setMarkdown loses the race with a tab switch", async () => {
    const { editor, handler } = harness("# a\n", ["editor"]);
    const pending = handler({ kind: "editor_set_markdown", markdown: "# b\n" });
    editor.installDocument(markdownToProsemirror("# other\n", schema));
    await expect(pending).rejects.toMatchObject({ code: "document-changed" });
  });
});
