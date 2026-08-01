// §298 vim §12-⑩ — chrome capability (design v7.2~v7.5 pins).
//
// Written against a stub before S2; since the real plugin ships in
// createBaramExtensions these tests drive IT via the setEnabled meta — the
// contract and the implementation are now the same thing.
//
// Pins covered:
// - v7.2 negative: real read-only + modal state → chrome stays locked.
// - v7.5 ⓐ silent transition: wrapper-driven lock hides chrome UI with NO
//   follow-up transaction.
// - v7.5 ⓑ guard alone: a SILENT lock (setEditable(false, false) — no
//   signal, no transaction) leaves stale UI mounted by design; clicking it
//   must not mutate the document. Reactive unmount cannot mask a missing
//   guard here because nothing unmounts.
// - §5b provenance: remove pill (chrome) dispatches tagged; input island
//   add stays untagged.

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { act, cleanup, render, renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { Extension, Editor as TiptapEditor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { useEditorChrome } from "../../../../hooks/use-editor-chrome";
import { setEditorEditable } from "../../../../utils/editor/editor-editable";
import { createBaramExtensions } from "../../../index";
import {
  canUseEditorChrome,
  isVimExternalEdit,
  vimPluginKey,
} from "../vim-keys";

// ── driving the REAL plugin (installed by createBaramExtensions) ───────────

function enableVimNormal(editor: Editor): void {
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: true,
        type: "setEnabled",
      }),
    );
  });
}

const editors: Editor[] = [];

function makeEditor(): Editor {
  const editor = new TiptapEditor({ extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

/** Flush React passive effects + the deferred NodeView portal mount. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("canUseEditorChrome (§12-⑩ predicate)", () => {
  it("is true for a plain editable editor", () => {
    expect(canUseEditorChrome(makeEditor())).toBe(true);
  });

  it("stays true during vim modal — the view is locked, chrome is not", () => {
    const editor = makeEditor();
    enableVimNormal(editor);
    expect(editor.view.editable).toBe(false);
    expect(canUseEditorChrome(editor)).toBe(true);
  });

  it("v7.2 negative pin: real read-only wins over modal state", () => {
    const editor = makeEditor();
    enableVimNormal(editor);
    act(() => setEditorEditable(editor, false));
    expect(canUseEditorChrome(editor)).toBe(false);
  });

  it("refuses to attribute a non-vim suppressor to vim", () => {
    // §12-⑪ bans such suppressors in src; this pins what the predicate does
    // if one appears anyway: locked, not misattributed.
    const editor = new TiptapEditor({
      extensions: [
        ...createBaramExtensions(),
        Extension.create({
          name: "foreignSuppressor",
          addProseMirrorPlugins() {
            return [new Plugin({ props: { editable: () => false } })];
          },
        }),
      ],
    });
    editors.push(editor);
    expect(editor.view.editable).toBe(false);
    expect(canUseEditorChrome(editor)).toBe(false);
  });

  it("is false after destroy", () => {
    const editor = new TiptapEditor({ extensions: createBaramExtensions() });
    editor.destroy();
    expect(canUseEditorChrome(editor)).toBe(false);
  });
});

describe("useEditorChrome (§12-⑩ reactive axes)", () => {
  it("v7.5 ⓐ: reacts to the wrapper signal with no transaction", () => {
    const editor = makeEditor();
    const { result } = renderHook(() => useEditorChrome(editor));
    expect(result.current).toBe(true);

    act(() => setEditorEditable(editor, false));
    expect(result.current).toBe(false);

    act(() => setEditorEditable(editor, true));
    expect(result.current).toBe(true);
  });

  it("rides transactions across modal flips", () => {
    const editor = makeEditor();
    const { result } = renderHook(() => useEditorChrome(editor));

    enableVimNormal(editor);
    expect(editor.view.editable).toBe(false);
    expect(result.current).toBe(true); // modal ≠ locked chrome

    act(() => setEditorEditable(editor, false));
    expect(result.current).toBe(false); // real read-only wins
  });
});

describe("FrontmatterView tag bar (§12-⑩ wiring)", () => {
  function setupFrontmatter() {
    const editor = makeEditor();
    const view = render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        content: [
          {
            content: [{ text: "tags: [alpha, beta]", type: "text" }],
            type: "frontmatter",
          },
          { type: "paragraph" },
        ],
        type: "doc",
      });
    });
    return { editor, view };
  }

  it("remove pill is chrome: tagged vimExternalEdit; input add is not", async () => {
    const { editor, view } = setupFrontmatter();
    await flush();

    const transactions: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => {
      transactions.push(transaction);
    });

    fireEvent.click(view.getByLabelText("Remove tag alpha"));
    expect(editor.state.doc.textContent).not.toContain("alpha");
    expect(isVimExternalEdit(transactions.at(-1)!)).toBe(true);

    // The NodeView's node prop refreshes on the tick AFTER the transaction
    // (see the wikilink test header) — flush before the next interaction.
    await flush();

    const input = view.getByLabelText("Add tag");
    fireEvent.change(input, { target: { value: "gamma" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(editor.state.doc.textContent).toContain("gamma");
    expect(isVimExternalEdit(transactions.at(-1)!)).toBe(false);
  });

  it("v7.5 ⓐ: wrapper lock hides the tag chrome without any transaction", async () => {
    const { editor, view } = setupFrontmatter();
    await flush();
    expect(view.getByLabelText("Remove tag alpha")).toBeTruthy();

    let sawTransaction = false;
    editor.on("transaction", () => {
      sawTransaction = true;
    });
    act(() => setEditorEditable(editor, false));
    await flush();

    expect(sawTransaction).toBe(false);
    expect(view.queryByLabelText("Remove tag alpha")).toBeNull();
    expect(view.queryByLabelText("Add tag")).toBeNull();
  });

  it("v7.5 ⓑ: the event-time guard blocks a stale remove pill by itself", async () => {
    const { editor, view } = setupFrontmatter();
    await flush();
    const pill = view.getByLabelText("Remove tag alpha");

    // A SILENT lock: no signal, no transaction — the hook is never told, so
    // the pill stays mounted. Only the guard stands between it and the doc.
    // (Direct setEditable is banned in src by the §12-⑪ scan; tests use it
    // precisely to simulate the rule being violated.)
    act(() => editor.setEditable(false, false));
    expect(view.getByLabelText("Remove tag alpha")).toBeTruthy();

    fireEvent.click(pill);
    expect(editor.state.doc.textContent).toContain("alpha");
  });
});

describe("CalloutView type picker (§12-⑩ wiring)", () => {
  function setupCallout() {
    const editor = makeEditor();
    const view = render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        content: [
          {
            attrs: { type: "tip" },
            content: [
              { content: [{ text: "body", type: "text" }], type: "paragraph" },
            ],
            type: "callout",
          },
        ],
        type: "doc",
      });
    });
    return { editor, view };
  }

  function calloutType(editor: Editor): string {
    let found = "";
    editor.state.doc.descendants((node) => {
      if (node.type.name === "callout") found = node.attrs.type as string;
      return !found;
    });
    return found;
  }

  it("selecting a type works while capability holds (control)", async () => {
    const { editor, view } = setupCallout();
    await flush();

    fireEvent.click(view.getByTitle("Change callout type"));
    fireEvent.click(view.getByTitle("Warning"));
    expect(calloutType(editor)).toBe("warning");
  });

  it("wrapper lock keeps the picker from opening", async () => {
    const { editor, view } = setupCallout();
    await flush();

    act(() => setEditorEditable(editor, false));
    await flush();

    fireEvent.click(view.getByTitle("Change callout type"));
    expect(view.queryByTitle("Warning")).toBeNull();
  });

  it("a reactive lock CLOSES an already-open picker (impl review R1)", async () => {
    const { editor, view } = setupCallout();
    await flush();

    fireEvent.click(view.getByTitle("Change callout type"));
    expect(view.getByTitle("Warning")).toBeTruthy();

    act(() => setEditorEditable(editor, false));
    await flush();
    expect(view.queryByTitle("Warning")).toBeNull();
  });

  it("v7.5 ⓑ: the guard blocks a stale open picker by itself", async () => {
    const { editor, view } = setupCallout();
    await flush();

    fireEvent.click(view.getByTitle("Change callout type"));
    // Silent lock while the picker is already open — it stays open (stale).
    act(() => editor.setEditable(false, false));
    expect(view.getByTitle("Warning")).toBeTruthy();

    fireEvent.click(view.getByTitle("Warning"));
    expect(calloutType(editor)).toBe("tip");
  });
});
