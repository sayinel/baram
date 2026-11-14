// §5.4 — the code block header's copy button: the `📋` the design draws at the right end of
// `언어 선택 드롭다운 + 복사 버튼`. Real render through CodeBlockNodeView, like the ✨ gate test
// beside this file, because the properties that matter are about the view's wiring — which
// node the text is read from, and when — not about the button in isolation.
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../..";
import { t } from "../../../../i18n";
import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { useAIStore } from "../../../../stores/ai/ai";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useUIStore } from "../../../../stores/ui/ui";

const editors: Editor[] = [];

function copyButton(editor: Editor): HTMLButtonElement {
  const btn = (editor.view.dom as HTMLElement).querySelector<HTMLButtonElement>(
    ".code-block-copy-btn",
  );
  if (!btn) throw new Error("no copy button");
  return btn;
}

function createEditor(md: string): Editor {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
  editors.push(editor);
  return editor;
}

/**
 * jsdom has no `navigator.clipboard` (jsdom 31.0.0, `'clipboard' in navigator` is false).
 * Defined on the instance rather than by replacing `navigator`, so the rest of it stays as
 * jsdom has it.
 */
function setClipboard(
  value: undefined | { writeText: typeof writeText },
): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

/** Let the clipboard promise settle and its toast land. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve());
  setClipboard({ writeText });
  useUIStore.setState({ toast: null });
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  Reflect.deleteProperty(navigator, "clipboard");
  useSettingsStore.setState({ locale: "en" });
  useAIStore.setState({ aiEnabled: true });
});

describe("the code block's copy button (§5.4)", () => {
  it("copies the block's code without its fence, and says so", async () => {
    const editor = createEditor("```ts\nconst x = 1;\nconst y = 2;\n```\n");
    copyButton(editor).click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      "const x = 1;\nconst y = 2;",
    );
    await settle();
    expect(useUIStore.getState().toast).toMatchObject({
      message: t("blockChrome.codeCopied", "en"),
      type: "info",
    });
  });

  it("copies the text as it is now, not as it was when the view was built", () => {
    const editor = createEditor("```ts\nold\n```\n");
    const btn = copyButton(editor);
    // Position 1 is the first character inside the block. A view that captured the text at
    // construction would still hand out `old`.
    editor.view.dispatch(editor.state.tr.insertText("new ", 1));
    // Same element: the edit updated the view in place rather than rebuilding it, so this is
    // the button the view built with `old`.
    expect(copyButton(editor)).toBe(btn);
    btn.click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("new old");
  });

  it("copies nothing from an empty block", async () => {
    const editor = createEditor("```ts\n```\n");
    copyButton(editor).click();
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("reports a rejected write instead of claiming success", async () => {
    writeText.mockImplementation(() => Promise.reject(new Error("denied")));
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    copyButton(editor).click();
    await settle();
    expect(useUIStore.getState().toast).toMatchObject({
      message: t("blockChrome.copyFailed", "en"),
      type: "error",
    });
  });

  it("reports a clipboard the webview does not have", async () => {
    // `navigator.clipboard` is undefined outside a secure context — the call throws before any
    // promise exists, so a `.catch` alone would let it escape the click handler unreported.
    setClipboard(undefined);
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    copyButton(editor).click();
    await settle();
    expect(useUIStore.getState().toast).toMatchObject({
      message: t("blockChrome.copyFailed", "en"),
      type: "error",
    });
  });

  it("does not take focus from where the user was when it is pressed", () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const press = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    copyButton(editor).dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("sits after the ✨ button, and stays when AI is turned off", () => {
    useAIStore.setState({ aiEnabled: false });
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const dom = editor.view.dom as HTMLElement;
    const actions = dom.querySelector(".code-block-header .code-block-actions");
    expect([...(actions?.children ?? [])].map((el) => el.classList[0])).toEqual(
      ["nodeview-ai-btn", "code-block-copy-btn"],
    );
    expect(
      dom.querySelector<HTMLButtonElement>(".code-block-ai-btn")?.hidden,
    ).toBe(true);
    expect(copyButton(editor).hidden).toBe(false);
  });

  it("names itself in the app's current language, read at every show", () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const btn = copyButton(editor);
    btn.dispatchEvent(new Event("pointerenter"));
    expect(btn.getAttribute("aria-label")).toBe(
      t("blockChrome.copyCode", "en"),
    );
    btn.dispatchEvent(new Event("pointerleave"));

    useSettingsStore.setState({ locale: "ko" });
    btn.dispatchEvent(new Event("pointerenter"));
    expect(btn.getAttribute("aria-label")).toBe(
      t("blockChrome.copyCode", "ko"),
    );
    expect(t("blockChrome.copyCode", "ko")).not.toBe(
      t("blockChrome.copyCode", "en"),
    );
    btn.dispatchEvent(new Event("pointerleave"));
  });

  it("lets go of its label when the view is destroyed", () => {
    const editor = createEditor("```ts\nconst x = 1;\n```\n");
    const btn = copyButton(editor);
    editors.splice(editors.indexOf(editor), 1);
    editor.destroy();
    btn.dispatchEvent(new Event("pointerenter"));
    expect(btn.hasAttribute("aria-label")).toBe(false);
  });
});
