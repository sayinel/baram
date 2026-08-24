// §298 Phase 1 (§12-9): cancellation infra contract (design §5c, 6차 핀 2).
import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { replaceEditorStateWithVim } from "../../../extensions/plugins/vim/replace-editor-state";
import {
  abortEditorMutationTasks,
  invalidateEditorMutationTasks,
  registerEditorMutationTask,
} from "../mutation-tasks";

const editors: Editor[] = [];

function makeEditor() {
  const editor = new Editor({
    content: "<p>x</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("mutation task lifecycle (§12-9)", () => {
  it("registering never advances the generation — concurrent tasks stay live", () => {
    const { view } = makeEditor();
    const a = registerEditorMutationTask(view);
    const b = registerEditorMutationTask(view);
    expect(a.isLive()).toBe(true);
    expect(b.isLive()).toBe(true);
    b.finish();
    // Finishing one task must not kill the other (핀: no advance on register).
    expect(a.isLive()).toBe(true);
    expect(b.isLive()).toBe(false);
  });

  it("invalidate is synchronous and kills ALL outstanding tasks", () => {
    const { view } = makeEditor();
    const a = registerEditorMutationTask(view);
    const b = registerEditorMutationTask(view);
    invalidateEditorMutationTasks(view);
    expect(a.isLive()).toBe(false);
    expect(b.isLive()).toBe(false);
    // A task registered AFTER invalidation belongs to the new generation.
    expect(registerEditorMutationTask(view).isLive()).toBe(true);
  });

  it("abort runs cleanups of invalidated tasks only, exactly once, errors swallowed", () => {
    const { view } = makeEditor();
    const calls: string[] = [];
    const dead = registerEditorMutationTask(view);
    dead.addCleanup(() => calls.push("dead"));
    dead.addCleanup(() => {
      throw new Error("boom");
    });
    invalidateEditorMutationTasks(view);

    const alive = registerEditorMutationTask(view);
    alive.addCleanup(() => calls.push("alive"));

    expect(() => abortEditorMutationTasks(view)).not.toThrow();
    expect(calls).toEqual(["dead"]);
    abortEditorMutationTasks(view); // idempotent — drained
    expect(calls).toEqual(["dead"]);
    expect(alive.isLive()).toBe(true);
  });

  it("finished tasks never run cleanups on a later invalidate+abort", () => {
    const { view } = makeEditor();
    const calls: string[] = [];
    const task = registerEditorMutationTask(view);
    task.addCleanup(() => calls.push("should-not-run"));
    task.finish();
    invalidateEditorMutationTasks(view);
    abortEditorMutationTasks(view);
    expect(calls).toEqual([]);
  });

  it("addCleanup after death cancels the source immediately", () => {
    const { view } = makeEditor();
    const calls: string[] = [];
    const task = registerEditorMutationTask(view);
    invalidateEditorMutationTasks(view);
    task.addCleanup(() => calls.push("immediate"));
    expect(calls).toEqual(["immediate"]);
  });

  it("views are isolated from each other", () => {
    const a = makeEditor();
    const b = makeEditor();
    const taskA = registerEditorMutationTask(a.view);
    const taskB = registerEditorMutationTask(b.view);
    invalidateEditorMutationTasks(a.view);
    expect(taskA.isLive()).toBe(false);
    expect(taskB.isLive()).toBe(true);
  });

  it("replaceEditorStateWithVim invalidates before install and aborts after (R6 hole)", () => {
    const editor = makeEditor();
    const order: string[] = [];
    const task = registerEditorMutationTask(editor.view);
    task.addCleanup(() => {
      order.push(`cleanup:live=${String(task.isLive())}`);
    });

    const next = EditorState.create({
      doc: editor.state.doc,
      plugins: editor.state.plugins,
    });
    replaceEditorStateWithVim(editor.view, next, "cached-restore");
    order.push("installed");

    // Cleanup ran during the install call (dead by then), before our marker.
    expect(order).toEqual(["cleanup:live=false", "installed"]);
    expect(task.isLive()).toBe(false);
    expect(editor.view.state).toBe(next);
  });
});
