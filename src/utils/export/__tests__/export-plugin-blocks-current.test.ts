// §394 spec 0073 D12 · plan 0125 Task 12 fix I1 — an export writes the drawing of each rendered
// block's CURRENT source. In the editor a block redraws only when it is on screen and rendered
// (D7), so its drawing can be of an older source or from before an `invalidate`; the view then keeps
// `data-render-state="pending"`, and settle wakes it (`drawDuePluginBlocks`) and waits.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

import { drawDuePluginBlocks } from "../../../plugins/rendered/due-redraws";
import { SOURCE_DEBOUNCE_MS } from "../../../plugins/rendered/limits";
import {
  __configureRenderQueue,
  invalidateRenders,
} from "../../../plugins/rendered/render-queue";
import { useEditorStore } from "../../../stores/editor/editor";
import { markContentLoaded } from "../../editor/programmatic-update";
import { pendingHeavyBlocks } from "../export-heavy-blocks";
import {
  bindChart,
  blockPos,
  cleanUp,
  editorWith,
  exported,
  hideAll,
  rootOf,
  shadowOf,
  showAll,
  templateOf,
} from "./helpers/plugin-block-editor";

afterEach(() => {
  cleanUp();
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
  useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
});

/** Let the debounced redraw an edit starts run out (`SOURCE_DEBOUNCE_MS`). */
function debounce(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, SOURCE_DEBOUNCE_MS + 100),
  );
}

describe("captureEditorHTML writes each rendered block's current drawing", () => {
  /** An edit while source editing is open: the debounced redraw finds the block in source mode
   *  and only marks it stale (D7), for as long as the caret stays. What fails this: a view that
   *  keeps `done` from its earlier draw (settle does not wait, and `C1` is written), or a settle
   *  with no wake for a due redraw (it waits out the stall budget — the test times out). */
  it("writes the edited source of a block whose source editing is still open", async () => {
    bindChart(async (source) => ({ html: `<p>${source}</p>` }));
    const editor = editorWith("Para.\n\n```chart\nC1\n```\n\nEnd.\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const at = blockPos(editor, "chart");
    editor.commands.setNodeSelection(at);
    expect(root.dataset.mode).toBe("source");
    editor.view.dispatch(editor.state.tr.insertText("C2", at + 1, at + 3));
    await debounce();
    expect(shadowOf(root).textContent).toBe("C1");
    const doc = await exported(editor);
    expect(templateOf(doc)?.textContent).toBe("C2");
  });

  /** An `invalidate` (D7 — a vault-dependent renderer's answer to `vault:changed`) reaches a block
   *  that is off screen: it is marked stale and draws when it comes into view. The new answer is
   *  held open by hand, and the redraw is of the SAME source — so only "in flight" keeps the block
   *  pending while it is held (settle's stall budget is 15 s; "not finished" is not a timing
   *  claim). What fails this: the two defects of the row above (`v1` is written, or settle never
   *  asks for `v2`), or a view that reads `done` while that redraw is in flight. */
  it("writes the new answer of an off-screen block invalidated since its drawing", async () => {
    __configureRenderQueue({ coalesceMs: 0 });
    let version = 1;
    let held = false;
    let release = (): void => undefined;
    bindChart(async () => {
      const drawn = version;
      if (drawn === 2) {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return { html: `<p>v${drawn}</p>` };
    });
    const editor = editorWith("Para.\n\n```chart\nX\n```\n\nEnd.\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    hideAll();
    version = 2;
    invalidateRenders("p");
    // The notice's timer was set first, so it has run when this one does.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowOf(root).textContent).toBe("v1");
    let finished = false;
    const capture = exported(editor).then((doc) => {
      finished = true;
      return doc;
    });
    await vi.waitFor(() => expect(held).toBe(true));
    // Two of settle's polls (`pollMs` 50).
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(finished).toBe(false);
    release();
    expect(templateOf(await capture)?.textContent).toBe("v2");
  });

  /** Leaving source editing draws the edited source at once, on screen — and the export taken in
   *  that moment waits for it. The renderer is held open by hand, so "not finished while held" is a
   *  fact of the code, not of timing: settle's stall budget is 15 s. What fails this: a view that
   *  keeps `done` from its earlier draw (the export finishes at once and writes `C1`). */
  it("waits for the redraw in flight when source editing has just closed", async () => {
    let held = false;
    let release = (): void => undefined;
    bindChart(async (source) => {
      if (source === "C2") {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return { html: `<p>${source}</p>` };
    });
    const editor = editorWith("Para.\n\n```chart\nC1\n```\n\nEnd.\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const at = blockPos(editor, "chart");
    editor.commands.setNodeSelection(at);
    editor.view.dispatch(editor.state.tr.insertText("C2", at + 1, at + 3));
    await debounce();
    editor.commands.setTextSelection(1);
    expect(root.dataset.mode).toBe("rendered");
    await vi.waitFor(() => expect(held).toBe(true));
    let finished = false;
    const capture = exported(editor).then((doc) => {
      finished = true;
      return doc;
    });
    // Two of settle's polls (`pollMs` 50).
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(finished).toBe(false);
    release();
    expect(templateOf(await capture)?.textContent).toBe("C2");
  });

  /** §6 · spec 0073 §7 "낡은 결과는 done" — a redraw of an edited source that FAILED keeps the last
   *  good drawing, faded, and the attempt has ended: settle does not wait, and that drawing is
   *  written. What fails this: a contract that counts only a successful draw of the current source
   *  as done — the block stays pending and the export waits out the stall budget. */
  it("writes the last good drawing when the edited source's redraw failed, without waiting", async () => {
    bindChart(async (source) => {
      if (source === "never") throw new Error("cannot");
      return { html: `<p>${source}</p>` };
    });
    const editor = editorWith("Para.\n\n```chart\nA\n```\n\nEnd.\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const at = blockPos(editor, "chart");
    editor.view.dispatch(editor.state.tr.insertText("never", at + 1, at + 2));
    await vi.waitFor(
      () =>
        expect(
          root.querySelector(".plugin-block-error")?.textContent,
        ).toContain("cannot"),
      { timeout: 2_000 },
    );
    expect(pendingHeavyBlocks(editor.view.dom)).toEqual([]);
    const doc = await exported(editor);
    expect(templateOf(doc)?.textContent).toBe("A");
  });
});

describe("drawDuePluginBlocks — settle's wake for a due redraw", () => {
  /** What fails this: a wake that draws only a block on screen and rendered (`drawWhenShown`'s
   *  rule — nothing would draw in source mode), one that starts another draw while one is in flight
   *  (each poll would drop the answer it waits for), one that draws a block with nothing due, or an
   *  edit's debounced redraw that marks the block stale though the wake already drew its source. */
  it("starts one draw of a due block in source mode, none while it is in flight, none once done", async () => {
    let held = false;
    let release = (): void => undefined;
    const render = vi.fn(async (source: string) => {
      if (source === "C2") {
        held = true;
        await new Promise<void>((resolve) => (release = resolve));
      }
      return { html: `<p>${source}</p>` };
    });
    bindChart(render);
    const editor = editorWith("Para.\n\n```chart\nC1\n```\n");
    showAll();
    const root = rootOf(editor);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    expect(drawDuePluginBlocks(editor.view.dom)).toBe(0);
    const at = blockPos(editor, "chart");
    editor.commands.setNodeSelection(at);
    editor.view.dispatch(editor.state.tr.insertText("C2", at + 1, at + 3));
    expect(root.dataset.mode).toBe("source");
    expect(root.dataset.renderState).toBe("pending");
    expect(drawDuePluginBlocks(editor.view.dom)).toBe(1);
    await vi.waitFor(() => expect(held).toBe(true));
    expect(drawDuePluginBlocks(editor.view.dom)).toBe(0);
    release();
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    expect(shadowOf(root).textContent).toBe("C2");
    expect(drawDuePluginBlocks(editor.view.dom)).toBe(0);
    // The edit's debounced redraw runs out after this draw: it finds nothing due.
    await debounce();
    expect(root.dataset.renderState).toBe("done");
    expect(render).toHaveBeenCalledTimes(2);
  });

  /** The lazy queue owns a block's first draw (`flushPendingVisibility`), and the wake reaches only
   *  the root it is given. What fails this: a wake that draws a block never drawn (the lazy queue
   *  would then draw it a second time) or one outside the exported editor. */
  it("starts no first draw, and no draw outside the root it is given", async () => {
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    }));
    bindChart(render);
    const never = editorWith("```chart\nN\n```\n");
    expect(drawDuePluginBlocks(never.view.dom)).toBe(0);
    expect(render).not.toHaveBeenCalled();
    showAll();
    const root = rootOf(never);
    await vi.waitFor(() => expect(root.dataset.renderState).toBe("done"));
    const at = blockPos(never, "chart");
    never.view.dispatch(never.state.tr.insertText("M", at + 1, at + 2));
    expect(root.dataset.renderState).toBe("pending");
    const other = editorWith("plain\n");
    expect(drawDuePluginBlocks(other.view.dom)).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });

  /** A block that cannot draw now starts nothing and is not counted, so settle's stall detector
   *  still runs out on it — and it stays pending (the export writes it as code). Two such blocks:
   *  one whose editor names no note (P29 — the shared editor while a keep-alive tab is the loaded
   *  one), and one whose binding is gone in an editor no registry change reaches (D6). What fails
   *  this: a wake that counts every due block it visits — settle then sees progress on every poll
   *  and waits out its two-minute ceiling instead of its stall budget. */
  it("counts no draw for a block that cannot draw now, and leaves it pending", async () => {
    __configureRenderQueue({ coalesceMs: 0 });
    const render = vi.fn(async (source: string) => ({
      html: `<p>${source}</p>`,
    }));
    const registration = bindChart(render);
    const bound = editorWith("```chart\nB\n```\n");
    showAll();
    const boundRoot = rootOf(bound);
    await vi.waitFor(() => expect(boundRoot.dataset.renderState).toBe("done"));
    hideAll();
    registration.dispose();
    invalidateRenders("p");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(boundRoot.dataset.renderState).toBe("pending");
    expect(drawDuePluginBlocks(bound.view.dom)).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);

    bindChart(render);
    const shared = editorWith("intro\n\n```chart\nS\n```\n");
    const pooled = editorWith("plain\n");
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [tab("t1", "/v/a.md"), tab("t2", "/v/b.md")],
    } as never);
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: shared,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: (id) => (id === "t2" ? pooled : null),
    });
    markContentLoaded("t2");
    showAll();
    const sharedRoot = rootOf(shared);
    expect(sharedRoot.dataset.renderState).toBe("pending");
    expect(drawDuePluginBlocks(shared.view.dom)).toBe(0);
    expect(render).toHaveBeenCalledTimes(1);
  });
});

/** Tab `id` showing `filePath`, as the editor store keeps it. */
function tab(id: string, filePath: string) {
  return {
    contextId: "",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
  };
}
