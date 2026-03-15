// §5.1 Source Code Mode — CodeMirror 6 editor (markdown + non-MD languages)
import { useEffect, useImperativeHandle, useRef } from "react";

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { getHighlightStyle } from "../../extensions/nodes/code-block-highlight";
import { getLanguageExtension } from "../../extensions/nodes/code-block-languages";
import { useSettingsStore } from "../../stores/settings/store";

export interface SourceCodeEditorRef {
  getContent(): string;
  getCursorOffset(): number;
  hasUserEdited(): boolean;
}

interface SourceCodeEditorProps {
  content: string;
  initialCursorOffset?: number;
  /** CodeMirror language name (e.g. "json", "python"). Omit or "markdown" for markdown. */
  language?: string;
  onChange: (content: string) => void;
  ref?: React.Ref<SourceCodeEditorRef>;
}

export function SourceCodeEditor({
  content,
  onChange,
  initialCursorOffset,
  language,
  ref,
}: SourceCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Guard: prevent onChange during destroy (React StrictMode double-invoke safety)
  const isDestroyingRef = useRef(false);
  // Track whether the user has genuinely edited (vs browser/IME artifacts)
  const userEditedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getCursorOffset(): number {
      if (!viewRef.current) return 0;
      return viewRef.current.state.selection.main.head;
    },
    getContent(): string {
      if (!viewRef.current) return "";
      return viewRef.current.state.doc.toString();
    },
    hasUserEdited(): boolean {
      return userEditedRef.current;
    },
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    isDestroyingRef.current = false;
    userEditedRef.current = false;

    // Guard: ignore spurious docChanged during initialization
    // WebKit injects "<!--  -->" into contenteditable on focus — must be cleaned up
    const originalContent = content;
    let initialized = false;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isDestroyingRef.current && initialized) {
        userEditedRef.current = true;
        onChange(update.state.doc.toString());
      }
    });

    const cursorPos = Math.min(initialCursorOffset ?? 0, content.length);
    const currentTabSize = useSettingsStore.getState().tabSize;
    const showLineNumbers = useSettingsStore.getState().lineNumbers;
    const autoPair = useSettingsStore.getState().autoPairBrackets;

    // Dynamic language via Compartment — markdown (sync), others (async)
    const langCompartment = new Compartment();
    const isMarkdown = !language || language === "markdown";
    const initialLang = isMarkdown ? markdown() : [];

    const state = EditorState.create({
      doc: content,
      extensions: [
        keymap.of([
          { key: "Mod-/", run: () => true }, // Swallow — handled by App's global shortcut
          ...defaultKeymap,
          ...historyKeymap,
          ...(autoPair ? closeBracketsKeymap : []),
          indentWithTab,
        ]),
        history(),
        ...(showLineNumbers ? [lineNumbers()] : []),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(getHighlightStyle()),
        ...(autoPair ? [closeBrackets()] : []),
        langCompartment.of(initialLang),
        updateListener,
        EditorView.lineWrapping,
        EditorState.tabSize.of(currentTabSize),
        indentUnit.of(" ".repeat(currentTabSize)),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "14px",
          },
          ".cm-content": {
            fontFamily: "var(--font-family-mono)",
            padding: "1rem 2rem",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--color-editor-cursor)",
          },
          ".cm-gutters": {
            backgroundColor: "var(--color-bg-subtle)",
            borderRight: "1px solid var(--color-border-subtle)",
          },
        }),
      ],
      selection: EditorSelection.cursor(cursorPos),
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Async language loading for non-markdown languages
    if (!isMarkdown && language) {
      getLanguageExtension(language).then((ext) => {
        if (isDestroyingRef.current || !ext) return;
        view.dispatch({ effects: langCompartment.reconfigure(ext) });
      });
    }

    // Two-phase init: focus first (triggers WebKit artifacts), then clean up
    requestAnimationFrame(() => {
      if (isDestroyingRef.current) return;

      // Focus first — WebKit may inject content (e.g., "<!--  -->") on focus
      view.focus();

      // Second frame: clean up any browser-injected artifacts, then enable onChange
      requestAnimationFrame(() => {
        if (isDestroyingRef.current) return;

        // Reset document if browser injected content during focus
        const currentContent = view.state.doc.toString();
        if (currentContent !== originalContent) {
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: originalContent,
            },
            selection: EditorSelection.cursor(
              Math.min(cursorPos, originalContent.length),
            ),
          });
        }

        initialized = true;

        // Scroll cursor into view
        if (cursorPos > 0) {
          view.dispatch({
            effects: EditorView.scrollIntoView(cursorPos, { y: "center" }),
          });
        }
      });
    });

    return () => {
      isDestroyingRef.current = true;
      view.destroy();
      viewRef.current = null;
    };
    // Only create once, content updates handled via onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="source-code-editor"
      ref={containerRef}
      style={{ height: "100%", overflow: "auto" }}
    />
  );
}
