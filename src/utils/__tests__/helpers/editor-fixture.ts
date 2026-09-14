// A real editor loaded through the pipeline, for tests that exercise route
// code on what the editor would actually serialize. Each test file keeps its
// own module mocks; this only builds editors and destroys them afterwards.
import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";

/** Editors built by `load`, destroyed together by `dispose` (call it in `afterEach`). */
export function createEditorFixture(): {
  dispose: () => void;
  load: (markdown: string) => Editor;
} {
  const editors: Editor[] = [];
  return {
    dispose: () => {
      for (const e of editors.splice(0)) e.destroy();
    },
    load: (markdown) => {
      const editor = new Editor({
        content: "",
        extensions: createBaramExtensions(),
      });
      editors.push(editor);
      editor.commands.setContent(
        markdownToProsemirror(markdown, editor.schema).toJSON(),
      );
      return editor;
    },
  };
}
