// §373 Smart punctuation inside the real extension set: it must be wired in,
// and it must not take a key from the syntax that other input rules build.
import type { JSONContent } from "@tiptap/core";

import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { typeChars } from "./helpers/type-chars";

let editor: Editor | null = null;
let host: HTMLElement | null = null;

function create(content: JSONContent | string = "<p></p>"): Editor {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    content,
    element: host,
    extensions: createBaramExtensions(),
  });
  editor.commands.focus("end");
  return editor;
}

function typed(text: string): Editor {
  typeChars(create(), text);
  return editor!;
}

beforeEach(() => {
  useSettingsStore.setState({ smartPunctuation: true });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  host?.remove();
  host = null;
  useSettingsStore.setState({ smartPunctuation: false });
});

describe("SmartPunctuation in the full extension set", () => {
  it("is wired in: a typed arrow becomes a symbol", () => {
    expect(typed("a -> b").state.doc.textContent).toBe("a → b");
  });

  it("is in the capture profile too", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      content: "<p></p>",
      element: host,
      extensions: createBaramExtensions({ profile: "capture" }),
    });
    editor.commands.focus("end");
    typeChars(editor, "a -> b");
    expect(editor.state.doc.textContent).toBe("a → b");
  });

  it("leaves `---` at the start of a line to the horizontal rule", () => {
    const names: string[] = [];
    typed("---").state.doc.forEach((node) => names.push(node.type.name));
    expect(names).toContain("horizontalRule");
  });

  it("leaves `> ` at the start of a line to the blockquote", () => {
    expect(typed("> ").state.doc.firstChild!.type.name).toBe("blockquote");
  });

  it("turns `>=` at the start of a line into `≥` (blockquote needs a space)", () => {
    expect(typed(">=").state.doc.textContent).toBe("≥");
  });

  it("keeps the arrow typed inside inline code before the closing backtick", () => {
    const text = typed("`a->b`").state.doc.firstChild!.firstChild!;
    expect(text.text).toBe("a->b");
    expect(text.marks.map((mark) => mark.type.name)).toContain("code");
  });

  it("keeps the arrow typed inside an inline math edit", () => {
    expect(typed("$a->b").state.doc.textContent).toContain("a->b");
  });

  it("keeps the arrow typed inside a wikilink target", () => {
    const node = typed("[[a->b]]").state.doc.firstChild!.firstChild!;
    expect(node.type.name).toBe("wikilink");
    expect(node.attrs.target).toBe("a->b");
  });

  it("does nothing in a skill file", () => {
    const skill = "name: x\ndescription: y";
    create({
      content: [
        {
          attrs: { yaml: skill },
          content: [{ text: skill, type: "text" }],
          type: "frontmatter",
        },
        { type: "paragraph" },
      ],
      type: "doc",
    });
    typeChars(editor!, "a -> b");
    expect(editor!.state.doc.lastChild!.textContent).toBe("a -> b");
  });
});
