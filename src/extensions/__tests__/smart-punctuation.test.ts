// §373 Smart punctuation rules, typed one key at a time (see type-chars.ts for
// why a whole-string insert cannot exercise them).
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { Bold } from "../marks/bold";
import { Paragraph } from "../nodes/paragraph";
import {
  SMART_PUNCTUATION_RULES,
  SmartPunctuation,
} from "../plugins/smart-punctuation";
import { pressBackspace, pressEnter, typeChars } from "./helpers/type-chars";

let editor: Editor | null = null;

function create(content = "<p></p>"): Editor {
  editor = new Editor({
    content,
    extensions: [Document, Paragraph, Text, Bold, SmartPunctuation],
  });
  editor.commands.focus("end");
  return editor;
}

function paragraphs(): string[] {
  const out: string[] = [];
  editor!.state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

function typed(text: string): string {
  typeChars(create(), text);
  return editor!.state.doc.textContent;
}

beforeEach(() => {
  useSettingsStore.setState({ smartPunctuation: true });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  useSettingsStore.setState({ smartPunctuation: false });
});

describe("SmartPunctuation — the rule table (spec 0056 §373)", () => {
  it.each([
    ["a -> b", "a → b"],
    ["a <- b", "a ← b"],
    ["a <-> b", "a ↔ b"],
    ["a => b", "a ⇒ b"],
    ["a <= b", "a ≤ b"],
    ["a <=> b", "a ⇔ b"],
    ["a >= b", "a ≥ b"],
    ["a != b", "a ≠ b"],
    ["wait...", "wait…"],
    ["a -- b", "a — b"],
    ["a--b", "a—b"],
  ])("turns %j into %j", (input, expected) => {
    expect(typed(input)).toBe(expected);
  });

  it.each([
    // `-->` closes an HTML comment; `->` must not fire after a dash.
    "a -->",
    "<!-- x -->",
    // `---` is a horizontal rule or a table delimiter; `--` must not fire
    // before a third dash, nor after one.
    "a --- b",
    "| --- |",
    "a--->b",
    // At the start of a textblock `--` may be the start of `---`.
    "--x",
  ])("leaves %j as typed", (input) => {
    expect(typed(input)).toBe(input);
  });

  it("lists exactly the rules of the spec's table", () => {
    expect(SMART_PUNCTUATION_RULES.map((rule) => rule.id).sort()).toEqual(
      [
        "arrowBoth",
        "arrowLeft",
        "arrowRight",
        "doubleRight",
        "ellipsis",
        "emDash",
        "greaterEqual",
        "iff",
        "lessEqual",
        "notEqual",
      ].sort(),
    );
  });
});

describe("SmartPunctuation — keys around a replacement", () => {
  it("lets Enter split the line after `--` instead of taking the key", () => {
    // Guarded twice: the core keymap outranks this extension, and the rule
    // excludes `\n`. This test sees the pair; the next one pins the rule alone
    // (measured: dropping the exclusion AND raising the priority fails here).
    typeChars(create(), "a --");
    expect(pressEnter(editor!)).toBe(true);
    expect(paragraphs()).toEqual(["a --", ""]);
  });

  it("does not match Enter's newline after `--`, whatever the priority", () => {
    const emDash = SMART_PUNCTUATION_RULES.find((rule) => rule.id === "emDash");
    expect(emDash!.find.test("a --\n")).toBe(false);
    expect(emDash!.find.test("a -- ")).toBe(true);
  });

  it("Backspace right after a replacement restores what was typed", () => {
    typeChars(create(), "a ->");
    expect(editor!.state.doc.textContent).toBe("a →");
    pressBackspace(editor!);
    expect(editor!.state.doc.textContent).toBe("a ->");
  });

  it("Backspace after `<=>` goes back one step, to `≤>`", () => {
    typeChars(create(), "<=>");
    expect(editor!.state.doc.textContent).toBe("⇔");
    pressBackspace(editor!);
    expect(editor!.state.doc.textContent).toBe("≤>");
  });
});

describe("SmartPunctuation — setting and marks", () => {
  it("reads the setting when a rule fires, not when the editor is built", () => {
    create();
    useSettingsStore.setState({ smartPunctuation: false });
    typeChars(editor!, "a -> ");
    expect(editor!.state.doc.textContent).toBe("a -> ");
    useSettingsStore.setState({ smartPunctuation: true });
    typeChars(editor!, "b -> ");
    expect(editor!.state.doc.textContent).toBe("a -> b → ");
  });

  it("keeps the marks of the text it replaces", () => {
    typeChars(create("<p><strong>a</strong></p>"), "->");
    const last = editor!.state.doc.firstChild!.lastChild!;
    expect(last.text).toBe("a→");
    expect(last.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
  });
});
