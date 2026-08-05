// §5.4 code block CodeMirror extension assembly — extracted from the
// NodeView so initCM reads as lifecycle, not configuration. Compartments are
// owned by the caller (they must outlive a CM recreation); this builder only
// places them.

import type { Compartment, Extension } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState as CMState } from "@codemirror/state";
import {
  EditorView as CMView,
  drawSelection,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { getHighlightStyle } from "../code-block-highlight";

export interface CodeBlockExtensionOptions {
  autoPairBrackets: boolean;
  /** The PM ↔ CM boundary keymap; placed FIRST so it wins over defaults. */
  keymapExtension: Extension;
  langExt: Extension | null;
  languageCompartment: Compartment;
  lineNumbers: boolean;
  /** Called for document-changing updates only. */
  onDocChanged: (update: ViewUpdate) => void;
  readOnly: boolean;
  readOnlyCompartment: Compartment;
  tabSize: number;
  /** §298 Phase 0b — vim slots, filled by the controller when enabled. */
  vimCompartment: Compartment;
  vimEditableCompartment: Compartment;
}

export function buildCodeBlockExtensions(
  options: CodeBlockExtensionOptions,
): Extension[] {
  const { autoPairBrackets, tabSize } = options;
  return [
    options.keymapExtension,
    keymap.of([
      ...defaultKeymap,
      ...(autoPairBrackets ? closeBracketsKeymap : []),
      indentWithTab,
    ]),
    ...(options.lineNumbers ? [lineNumbers()] : []),
    drawSelection(),
    bracketMatching(),
    ...(autoPairBrackets ? [closeBrackets()] : []),
    syntaxHighlighting(getHighlightStyle()),
    CMView.lineWrapping,
    CMState.tabSize.of(tabSize),
    indentUnit.of(" ".repeat(tabSize)),
    options.readOnlyCompartment.of(CMState.readOnly.of(options.readOnly)),
    options.vimCompartment.of([]),
    options.vimEditableCompartment.of([]),
    CMView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) options.onDocChanged(update);
    }),
    options.languageCompartment.of(options.langExt ? [options.langExt] : []),
  ];
}
