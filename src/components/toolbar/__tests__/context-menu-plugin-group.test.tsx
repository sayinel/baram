// §391 spec 0070 §6 · §10 — the plugin group reaches all three `setItems` sites of the real
// ContextMenu (inline math, math block, everything else), MenuList draws `detail`, and the
// group leaves with the plugin.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../../plugins/plugin-host-registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../plugins/plugin-host-registry")
  >()),
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import { createBaramExtensions } from "../../../extensions";
import en from "../../../i18n/en.json";
import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../../../plugins/plugin-host-registry";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { unregisterPluginUI } from "../../../plugins/trusted/ui-api";
import { ContextMenu } from "../ContextMenu";

const editors: Editor[] = [];

beforeEach(() => {
  usePluginUIStore.setState({
    contributions: {
      cite: {
        commands: [{ id: "insert", title: "Insert citation" }],
        menu: [{ command: "insert", id: "m" }],
        name: "Cite",
        pluginId: "cite",
        slash: [],
      },
    },
  });
  registerHostCommandHandler("cite.insert", () => {}, "cite");
});
afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  commandHandlers.clear();
  commandOwners.clear();
  execute.mockClear();
});

async function mount(doc: Record<string, unknown>): Promise<Editor> {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  render(
    <>
      <EditorContent editor={editor} />
      <ContextMenu editor={editor} />
    </>,
  );
  await act(async () => {
    editor.commands.setContent(doc);
    await Promise.resolve();
  });
  return editor;
}

/** The open menu's rows — a separator as "—", an item as its text. */
async function rightClick(target: Element): Promise<void> {
  await act(async () => {
    fireEvent.contextMenu(target, { clientX: 20, clientY: 20 });
    await Promise.resolve();
  });
}

function rows(): string[] {
  return [...document.querySelectorAll(".context-menu > *")].map((el) =>
    el.classList.contains("context-menu-separator")
      ? "—"
      : (el.textContent ?? "").trim(),
  );
}

const textDoc = {
  content: [{ content: [{ text: "hello", type: "text" }], type: "paragraph" }],
  type: "doc",
};
const mathDoc = {
  content: [
    { attrs: { formula: "x^2" }, type: "mathBlock" },
    {
      content: [{ attrs: { formula: "y" }, type: "mathInline" }],
      type: "paragraph",
    },
  ],
  type: "doc",
};

/** jsdom has no layout: hand the generic branch a real position (toolbar-i18n.test.tsx). */
async function openTextMenu(): Promise<void> {
  const editor = await mount(textDoc);
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 1, pos: 1 });
  await rightClick(editor.view.dom.firstElementChild ?? editor.view.dom);
}

describe("the plugin group in the real right-click menu (§391 §6)", () => {
  it("text: after the built items, a separator, then the item with the plugin's name beside it", async () => {
    await openTextMenu();
    const r = rows();
    expect(r.length).toBeGreaterThan(2); // the built menu is still there
    expect(r.slice(-2)).toEqual(["—", "Insert citation Cite"]);
    expect(
      document.querySelector(".context-menu-item-label")?.textContent,
    ).toBe("Insert citation");
    expect(
      document.querySelector(".context-menu-item-detail")?.textContent,
    ).toBe("Cite");
  });

  it("math block: the group follows the math block's own menu", async () => {
    const editor = await mount(mathDoc);
    const block = editor.view.nodeDOM(0);
    if (!(block instanceof HTMLElement))
      throw new Error("mathBlock rendered no element");
    // The NodeView renders no `data-type` (toolbar-i18n.test.tsx, "the math node menus"), so a
    // real right-click never reaches this site today; tag it the way `findSpecialNode` looks.
    block.setAttribute("data-type", "mathBlock");
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      inside: -1,
      pos: 0,
    });
    await rightClick(block);
    const r = rows();
    expect(r[0]).toBe(en["mathMenu.copyLatex"]);
    expect(r.slice(-2)).toEqual(["—", "Insert citation Cite"]);
  });

  it("inline math: the group follows the inline math menu", async () => {
    const editor = await mount(mathDoc);
    let at = -1;
    editor.state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === "mathInline") at = pos;
      return at < 0;
    });
    const dom = editor.view.nodeDOM(at);
    if (!(dom instanceof HTMLElement))
      throw new Error("mathInline rendered no element");
    dom.setAttribute("data-type", "mathInline"); // same reason as the block above
    await rightClick(dom);
    const r = rows();
    expect(r[0]).toBe(en["mathMenu.copyLatex"]);
    expect(r.slice(-2)).toEqual(["—", "Insert citation Cite"]);
  });

  it("clicking the item runs the command by its full id, then closes the menu", async () => {
    await openTextMenu();
    fireEvent.click(screen.getByText("Insert citation"));
    expect(execute).toHaveBeenCalledWith("cite.insert");
    expect(document.querySelector(".context-menu")).toBeNull();
  });

  it("after the plugin unloads, the group is gone — the separator with it", async () => {
    unregisterPluginUI("cite");
    await openTextMenu();
    const r = rows();
    expect(r.length).toBeGreaterThan(0); // the menu did open
    expect(r.some((row) => row.includes("Insert citation"))).toBe(false);
    expect(document.querySelector(".context-menu-item-detail")).toBeNull();
  });
});
