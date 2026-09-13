// §5.1 Inline Code Mark Extension — `text`
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

export interface CodeOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    code: {
      setCode: () => ReturnType;
      toggleCode: () => ReturnType;
      unsetCode: () => ReturnType;
    };
  }
}

const inputRegex = /(?:^|[^`])(`(?!\s+`)((?:[^`]+))`(?!`))$/;
const pasteRegex = /(?:^|[^`])(`(?!\s+`)((?:[^`]+))`(?!`))/g;

export const Code = Mark.create<CodeOptions>({
  name: "code",
  // §7.2: excludes를 두지 않는다. `**`x`**`는 GFM에서 유효한 구문이고,
  // 파이프라인은 mark 배열을 직접 만들어(addMark 미경유) 그 조합을 읽어 들인다.
  // `excludes: "_"`가 있으면 `Mark.addToSet`을 지나는 경로 — 에디터 DOM 재파싱
  // (한글 IME 조합·맞춤법 교정)과 붙여넣기 — 에서만 다른 마크가 떨어져 나가,
  // 같은 문서를 경로마다 다르게 해석했다. 네 경로의 합의는
  // `__tests__/code-mark-coexistence.test.ts`가 지킨다.

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "code" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "code",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return makeMarkCommands(this.name);
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.inlineCode", "Mod-e");
    return { [key]: () => this.editor.commands.toggleCode() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
