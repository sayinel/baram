// §390 · §317 — the cross-vault badge finds its vault by the ruler a click
// uses (findAliasContext): a space name (`Journal::`), and an alias that is a
// folder's name the disk stores decomposed (NFD).
//
// Mounting follows wikilink-view.test.tsx: React NodeViews render only
// through <EditorContent>, and the portal lands a tick after the transaction.
import type { ContextInfo } from "../../../ipc/types";

import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { useContextStore } from "../../../stores/context/context";
import { createBaramExtensions } from "../../index";

const DIARY = "일기";
const DIARY_NFD = DIARY.normalize("NFD");

function context(over: Partial<ContextInfo>): ContextInfo {
  return {
    addedAt: 0,
    color: "#123456",
    contextType: "vault",
    id: over.path ?? "c",
    label: "L",
    path: "/v",
    ...over,
  } as ContextInfo;
}

describe("§390 WikilinkView — the vault badge", () => {
  let editor: Editor;

  afterEach(async () => {
    // Destroying the editor removes its NodeView renderers, and the portal host
    // learns of it a microtask later — inside this act, not after it.
    await act(async () => {
      editor.destroy();
      await Promise.resolve();
    });
    useContextStore.setState({ contexts: [] });
  });

  async function link(vaultAlias: string): Promise<HTMLElement> {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions(),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ attrs: { target: "x", vaultAlias }, type: "wikilink" }],
          },
        ],
      });
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    return editor.view.dom.querySelector(".wikilink") as HTMLElement;
  }

  it("a space name finds the journal kept in a folder of another name", async () => {
    // What fails this: the badge looking aliases up by itself, without the
    // space names — `Journal` is no context's alias here.
    useContextStore.setState({
      contexts: [
        context({ alias: DIARY, path: `/v/${DIARY}`, vaultType: "journal" }),
      ],
    });
    const el = await link("Journal");
    expect(el.classList.contains("wikilink--dangling")).toBe(false);
  });

  it("an alias typed composed finds the vault whose folder is stored decomposed", async () => {
    // What fails this: aliases compared by toLowerCase.
    expect(DIARY_NFD).not.toBe(DIARY);
    useContextStore.setState({
      contexts: [context({ alias: DIARY_NFD, path: `/v/${DIARY_NFD}` })],
    });
    const el = await link(DIARY);
    expect(el.classList.contains("wikilink--dangling")).toBe(false);
  });

  it("an alias no vault has is still dangling", async () => {
    // The partner: the badge still marks an alias nothing answers to.
    useContextStore.setState({
      contexts: [context({ alias: DIARY_NFD, path: `/v/${DIARY_NFD}` })],
    });
    const el = await link("없는 볼트");
    expect(el.classList.contains("wikilink--dangling")).toBe(true);
  });
});
