// §298 §12-⑩ — the query block adopts the entry model, in builder form.
//
// Same disease, different organ: the builder panel was keyed on bare
// `selected`, so a vim traversal NodeSelection opened the full visual builder
// (filters, sorts, run button) — the device finding fixed for math in
// f12e2af0. Unlike the textarea islands the builder never steals focus on
// open, so this was purely the §12-⑩ chrome violation, but the entry
// contract is the same: traversal keeps the block closed, `i` or a click
// opens it.
//
// The standby here is an INPUT, not a textarea — vim's preflight
// (atom-insert.ts islandEntry) queries "textarea, input, select, …", and the
// builder itself only exists while editing. Its focus opens the session and
// forwards into the first builder control. Esc inside the builder lands
// normal mode and the block's NodeSelection atomically; there is no save
// step because every builder change commits immediately (tagged chrome).

import { act, fireEvent, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { useSettingsStore } from "../../../../stores/settings/store";
import { vimPluginKey } from "../../../plugins/vim/vim-keys";

// Observe query execution without the vault IPC round-trip.
const { executeSpy } = vi.hoisted(() => ({ executeSpy: vi.fn() }));
// §310 결과가 소스로 판별되면서 훅이 `resultCount`도 내보낸다 — 뷰가 그것을 부르므로
// 모의에도 있어야 한다(없으면 렌더 자체가 던진다).
vi.mock("../../../../hooks/use-query-block", () => ({
  resultCount: () => 0,
  useQueryBlock: () => ({
    error: null,
    execute: executeSpy,
    loading: false,
    results: { files: [], source: "files" },
    vaultPath: "/",
  }),
}));

const editors: Editor[] = [];

/** Flush React effects, dynamic-import microtasks, and rAF callbacks. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

const DOC: JSONContent = {
  content: [
    { content: [{ text: "above", type: "text" }], type: "paragraph" },
    { attrs: { query: "tags contains x" }, type: "queryBlock" },
    { content: [{ text: "below", type: "text" }], type: "paragraph" },
  ],
  type: "doc",
};

function container(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".qb-container");
  expect(el).not.toBeNull();
  return el!;
}

function queryPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "queryBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
}

async function selectBlock(editor: Editor): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(queryPos(editor));
  });
  await flush();
}

function setup(): Editor {
  const editor = new Editor({
    content: DOC,
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("vim modal: selection alone keeps the builder closed", () => {
  it("a traversal NodeSelection does NOT open the builder", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(container().className).not.toContain("qb-editing");
    expect(container().querySelector(".qb-builder")).toBeNull();
  });

  it("a click while modal only SELECTS the block — `i` is the entry", async () => {
    // UX decision (issue 408): normal mode is navigation; the builder opens
    // via `i` (or click in insert mode / vim off).
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    act(() => {
      fireEvent.click(container());
    });
    await flush();

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(queryPos(editor));
    expect(container().querySelector(".qb-builder")).toBeNull();
  });

  it("the standby input is mounted, inert to Tab and AT", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);

    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    );
    expect(standby).not.toBeNull();
    expect(standby!.tabIndex).toBe(-1);
    expect(standby!.getAttribute("aria-hidden")).toBe("true");
  });

  it("focus arriving in the standby input opens the builder", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();

    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;
    expect(standby).not.toBeNull();

    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();

    expect(container().className).toContain("qb-editing");
    expect(container().querySelector(".qb-builder")).not.toBeNull();
  });
});

describe("Esc inside the builder follows the stair (vim)", () => {
  it("lands normal mode and the block's NodeSelection atomically", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;
    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    const builder = container().querySelector<HTMLElement>(".qb-builder")!;
    expect(builder).not.toBeNull();

    act(() => {
      fireEvent.keyDown(builder.querySelector("select") ?? builder, {
        key: "Escape",
      });
    });
    await flush();

    const vim = vimPluginKey.getState(editor.state);
    expect(vim?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(queryPos(editor));
    expect(container().querySelector(".qb-builder")).toBeNull();
  });

  it("entry from SURFACE insert mode still lands in normal on the block", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    act(() => {
      editor.commands.setTextSelection(2);
    });
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: "i" });
    });
    await flush();

    act(() => {
      fireEvent.click(container());
    });
    await flush();
    const builder = container().querySelector<HTMLElement>(".qb-builder")!;
    expect(builder).not.toBeNull();

    act(() => {
      fireEvent.keyDown(builder.querySelector("select") ?? builder, {
        key: "Escape",
      });
    });
    await flush();

    const vim = vimPluginKey.getState(editor.state);
    expect(vim?.mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(queryPos(editor));
  });
});

describe("session transitions (adversarial review of the query port)", () => {
  it("i-entry hands focus into the builder without a task gap", async () => {
    // A setTimeout forward leaves a window where the standby has unmounted
    // and focus sits on <body> — a fast keypress lands in global handlers and
    // vim's focusout microtask briefly resumes normal mode. The forward must
    // happen at the COMMIT that mounts the builder (layout effect), with the
    // standby kept mounted while selected so no unmount-blur precedes it.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;

    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });

    // No flush: the very next assertion sees the post-commit world.
    expect(document.activeElement?.closest(".qb-builder")).not.toBeNull();
    expect(container().querySelector("input[data-vim-suspend]")).not.toBeNull();
  });

  it("a traversal landing on a CLOSED block does not execute", async () => {
    // execute() recursively lists the vault and reads every markdown file —
    // an effect keyed on `selected` re-ran it on every landing AND leaving of
    // a closed block, so j/k through a doc with query blocks launched
    // overlapping whole-vault scans (adversarial re-review, high).
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    executeSpy.mockClear();

    await selectBlock(editor); // land
    act(() => {
      editor.commands.setTextSelection(2); // leave
    });
    await flush();

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("deselecting an OPEN session executes exactly once", async () => {
    // The old predicate double-fired: the deselection render satisfied
    // !selected, then the lifecycle effect flipped isEditing and re-ran it.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;
    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    executeSpy.mockClear();

    act(() => {
      editor.commands.setTextSelection(2);
    });
    await flush();

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("surface `i` over an already-open builder lands in the builder", async () => {
    // The standby sits before .qb-builder in DOM order and vim's preflight
    // takes the FIRST focusable — with the session already open and focus
    // back on the surface, a second `i` focused the read-only hidden proxy
    // and keys went nowhere (adversarial re-review). An already-open standby
    // focus must forward. (Setup opens via the standby — the `i` path — since
    // a modal click is navigation-only by the issue-408 UX decision.)
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;
    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    expect(container().querySelector(".qb-builder")).not.toBeNull();

    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus")); // second `i`
    });

    expect(document.activeElement?.closest(".qb-builder")).not.toBeNull();
  });

  it("closing the session re-runs the committed query", async () => {
    // Builder edits commit immediately, but auto-run was keyed on !selected —
    // Esc closed the builder while the block stayed selected, stranding stale
    // results behind it until an unrelated deselection.
    useSettingsStore.setState({ vimMode: true });
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const standby = container().querySelector<HTMLInputElement>(
      "input[data-vim-suspend]",
    )!;
    act(() => {
      standby.focus();
      standby.dispatchEvent(new FocusEvent("focus"));
    });
    await flush();
    const builder = container().querySelector<HTMLElement>(".qb-builder")!;
    executeSpy.mockClear();

    act(() => {
      fireEvent.keyDown(builder.querySelector("select") ?? builder, {
        key: "Escape",
      });
    });
    await flush();

    expect(executeSpy).toHaveBeenCalledWith("tags contains x");
  });
});

describe("vim off is untouched (positive controls)", () => {
  it("a plain NodeSelection opens the builder as before", async () => {
    const editor = setup();
    await flush();

    await selectBlock(editor);

    expect(container().className).toContain("qb-editing");
    expect(container().querySelector(".qb-builder")).not.toBeNull();
  });

  it("Esc inside the builder stays inert without vim", async () => {
    // Query never had an Esc handler — the builder simply stays open. The
    // stair is a vim contract, not a general one.
    const editor = setup();
    await flush();
    await selectBlock(editor);
    const builder = container().querySelector<HTMLElement>(".qb-builder")!;

    act(() => {
      fireEvent.keyDown(builder.querySelector("select") ?? builder, {
        key: "Escape",
      });
    });
    await flush();

    expect(container().querySelector(".qb-builder")).not.toBeNull();
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });
});
