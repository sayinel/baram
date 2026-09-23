// §374 Where typed punctuation must stay literal. Every guard is tested from
// both sides: refused inside its context, allowed one step outside it — a
// refusal alone would also pass if the guard refused everything.
import type { JSONContent } from "@tiptap/core";

import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { Code } from "../marks/code";
import { Frontmatter } from "../nodes/frontmatter";
import { MathInline } from "../nodes/math-inline";
import { Paragraph } from "../nodes/paragraph";
import { MathInlineEdit } from "../plugins/math-inline-edit";
import { shouldSubstitute } from "../plugins/smart-punctuation-guards";
import { typeChars } from "./helpers/type-chars";

let editor: Editor | null = null;

function allowedAtCaret(): boolean {
  const { from } = editor!.state.selection;
  return shouldSubstitute(editor!.state, { from, to: from });
}

function create(content: JSONContent | string = "<p></p>"): Editor {
  editor = new Editor({
    content,
    extensions: [
      Document,
      Paragraph,
      Text,
      Code,
      Frontmatter,
      MathInline,
      MathInlineEdit,
    ],
  });
  editor.commands.focus("end");
  return editor;
}

function frontmatterDoc(attrYaml: string, textYaml: string): JSONContent {
  return {
    content: [
      {
        attrs: { yaml: attrYaml },
        content: textYaml ? [{ text: textYaml, type: "text" }] : [],
        type: "frontmatter",
      },
      { type: "paragraph" },
    ],
    type: "doc",
  };
}

/** Type `text` into a fresh paragraph and ask the guard at the caret. */
function typedThenAllowed(text: string): boolean {
  typeChars(create(), text);
  return allowedAtCaret();
}

beforeEach(() => {
  useSettingsStore.setState({ smartPunctuation: true });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  useSettingsStore.setState({ smartPunctuation: false });
});

describe("shouldSubstitute — setting (§373)", () => {
  it("refuses while the setting is off and allows once it is on", () => {
    create();
    useSettingsStore.setState({ smartPunctuation: false });
    expect(allowedAtCaret()).toBe(false);
    useSettingsStore.setState({ smartPunctuation: true });
    expect(allowedAtCaret()).toBe(true);
  });
});

describe("shouldSubstitute — skill files (§373)", () => {
  const SKILL = "name: x\ndescription: y";

  it("refuses in a document whose frontmatter makes it a skill", () => {
    create(frontmatterDoc(SKILL, SKILL));
    expect(allowedAtCaret()).toBe(false);
  });

  it("allows once the frontmatter no longer names a description", () => {
    create(frontmatterDoc("name: x", "name: x"));
    expect(allowedAtCaret()).toBe(true);
  });

  it("reads the frontmatter text, not the yaml attribute set at load", () => {
    // `attrs.yaml` is filled once by the pipeline and never follows edits;
    // saving writes `textContent`. A stale attribute must not decide.
    create(frontmatterDoc(SKILL, "name: x"));
    expect(allowedAtCaret()).toBe(true);
    editor!.destroy();
    create(frontmatterDoc("name: x", SKILL));
    expect(allowedAtCaret()).toBe(false);
  });
});

describe("shouldSubstitute — inline code (§374-1)", () => {
  it("refuses at the end of code text, where typing continues the code", () => {
    create("<p><code>ab</code></p>");
    expect(allowedAtCaret()).toBe(false);
  });

  it("allows after text that follows the code", () => {
    create("<p><code>ab</code>c</p>");
    expect(allowedAtCaret()).toBe(true);
  });

  it("follows stored marks: allows right after leaving the code", () => {
    create("<p><code>ab</code></p>");
    editor!.commands.unsetCode();
    expect(allowedAtCaret()).toBe(true);
  });
});

describe("shouldSubstitute — inline math being edited (§374-4)", () => {
  it("refuses inside an open inline math edit", () => {
    create();
    typeChars(editor!, "$a");
    expect(allowedAtCaret()).toBe(false);
  });

  it("allows in plain text with no math edit open", () => {
    expect(typedThenAllowed("a")).toBe(true);
  });
});

describe("shouldSubstitute — unclosed spans (§374-2,3,5,6,7)", () => {
  it.each([
    ["[[a", "[[a]] b"],
    ["{{a", "{{a}} b"],
    ["((a", "((a)) b"],
    ["[^a", "[^a] b"],
    ["`a", "`a` b"],
    ["[t](./a", "[t](./a) b"],
    ["see https://x.io/a", "see https://x.io/a b"],
    ["(https://x.io/a", "(https://x.io/a) b"],
    ["#foo", "#foo b"],
    ["#a/b", "#a/b c"],
  ])("refuses after %j, allows after %j", (inside, outside) => {
    expect(typedThenAllowed(inside)).toBe(false);
    editor!.destroy();
    expect(typedThenAllowed(outside)).toBe(true);
  });
});
