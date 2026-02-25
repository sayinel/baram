// §5.4 CodeMirror 6 NodeView for Code Blocks
import { useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { EditorView, ViewUpdate, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting, indentUnit } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { getLanguageExtension, LANGUAGE_OPTIONS } from "./code-block-languages";
import { getHighlightStyle } from "./code-block-highlight";
import { useSettingsStore } from "../../stores/settings-store";

export function CodeBlockView({ node, updateAttributes, editor, getPos, selected }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const updatingRef = useRef(false);
  const language = (node.attrs.language as string) || "";
  const tabSize = useSettingsStore((s) => s.tabSize);
  const showLineNumbers = useSettingsStore((s) => s.codeBlockLineNumbers);
  const autoPair = useSettingsStore((s) => s.autoPairBrackets);
  const appTheme = useSettingsStore((s) => s.theme);
  const codeBlockStyle = useSettingsStore((s) => s.codeBlockStyle);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value || null });
    },
    [updateAttributes],
  );

  // Helper: focus ProseMirror and set cursor before/after code block
  const exitToPos = useCallback(
    (pos: number) => {
      editor.chain().focus().setTextSelection(pos).run();
    },
    [editor],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    // §8.4 Language extensions are loaded asynchronously to reduce initial bundle
    async function initEditor() {
      const langExt = await getLanguageExtension(language);
      if (destroyed || !containerRef.current) return;

      const currentTabSize = useSettingsStore.getState().tabSize;
      const currentShowLineNumbers = useSettingsStore.getState().codeBlockLineNumbers;
      const currentAutoPair = useSettingsStore.getState().autoPairBrackets;

      // Custom keymaps for PM ↔ CM navigation
      const customKeymap = keymap.of([
        {
          key: "ArrowUp",
          run: (view) => {
            const { head } = view.state.selection.main;
            const line = view.state.doc.lineAt(head);
            if (line.number === 1) {
              const pos = getPos();
              if (typeof pos === "number") exitToPos(pos);
              return true;
            }
            return false;
          },
        },
        {
          key: "ArrowDown",
          run: (view) => {
            const { head } = view.state.selection.main;
            const line = view.state.doc.lineAt(head);
            if (line.number === view.state.doc.lines) {
              const pos = getPos();
              if (typeof pos === "number") {
                const pmNode = editor.view.state.doc.nodeAt(pos);
                if (pmNode) exitToPos(pos + pmNode.nodeSize);
              }
              return true;
            }
            return false;
          },
        },
        {
          key: "Escape",
          run: () => {
            const pos = getPos();
            if (typeof pos === "number") exitToPos(pos);
            return true;
          },
        },
        {
          key: "Backspace",
          run: (view) => {
            // Empty code block + cursor at start → convert to paragraph
            const { head } = view.state.selection.main;
            if (head === 0 && view.state.doc.length === 0) {
              const pos = getPos();
              if (typeof pos === "number") {
                editor.chain().focus().setTextSelection(pos + 1).toggleCodeBlock().run();
              }
              return true;
            }
            return false;
          },
        },
        {
          key: "Mod-z",
          run: () => {
            editor.commands.undo();
            return true;
          },
        },
        {
          key: "Mod-Shift-z",
          run: () => {
            editor.commands.redo();
            return true;
          },
        },
        {
          key: "Mod-y",
          run: () => {
            editor.commands.redo();
            return true;
          },
        },
      ]);

      const extensions = [
        customKeymap,
        keymap.of([...defaultKeymap, ...(currentAutoPair ? closeBracketsKeymap : []), indentWithTab]),
        ...(currentShowLineNumbers ? [lineNumbers()] : []),
        drawSelection(),
        bracketMatching(),
        ...(currentAutoPair ? [closeBrackets()] : []),
        syntaxHighlighting(getHighlightStyle()),
        EditorView.lineWrapping,
        EditorState.tabSize.of(currentTabSize),
        indentUnit.of(" ".repeat(currentTabSize)),
        EditorState.readOnly.of(!editor.isEditable),
        // Sync CodeMirror → ProseMirror
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged || updatingRef.current) return;
          const pos = getPos();
          if (typeof pos !== "number") return;

          const pmNode = editor.view.state.doc.nodeAt(pos);
          if (!pmNode) return;

          const newText = update.state.doc.toString();
          updatingRef.current = true;

          const start = pos + 1;
          const end = start + pmNode.content.size;
          const { tr } = editor.view.state;

          if (newText) {
            tr.replaceWith(start, end, editor.view.state.schema.text(newText));
          } else {
            tr.delete(start, end);
          }
          editor.view.dispatch(tr);
          updatingRef.current = false;
        }),
        ...(langExt ? [langExt] : []),
      ];

      const state = EditorState.create({
        doc: node.textContent,
        extensions,
      });

      const view = new EditorView({
        state,
        parent: containerRef.current,
      });

      cmViewRef.current = view;

      // Auto-focus newly created (empty) code blocks
      if (!node.textContent) {
        requestAnimationFrame(() => {
          if (!destroyed && cmViewRef.current) cmViewRef.current.focus();
        });
      }
    }

    initEditor();

    return () => {
      destroyed = true;
      if (cmViewRef.current) {
        cmViewRef.current.destroy();
        cmViewRef.current = null;
      }
    };
    // Recreate when language, tabSize, or lineNumbers changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, tabSize, showLineNumbers, autoPair, appTheme]);

  // Focus CodeMirror when ProseMirror selects this code block (NodeSelection)
  useEffect(() => {
    if (selected && cmViewRef.current) {
      cmViewRef.current.focus();
    }
  }, [selected]);

  // Focus CodeMirror when ProseMirror cursor enters this code block (TextSelection)
  useEffect(() => {
    const handleSelectionUpdate = () => {
      const cmView = cmViewRef.current;
      if (!cmView || cmView.hasFocus) return;

      const pos = getPos();
      if (typeof pos !== "number") return;

      const pmNode = editor.view.state.doc.nodeAt(pos);
      if (!pmNode) return;

      const { from } = editor.state.selection;
      // Check if PM selection is inside this code block
      if (from > pos && from < pos + pmNode.nodeSize) {
        cmView.focus();
      }
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, getPos]);

  // Sync ProseMirror → CodeMirror (undo/redo, external changes)
  useEffect(() => {
    const cmView = cmViewRef.current;
    if (!cmView || updatingRef.current) return;

    const newContent = node.textContent;
    const currentContent = cmView.state.doc.toString();

    if (newContent !== currentContent) {
      updatingRef.current = true;
      cmView.dispatch({
        changes: {
          from: 0,
          to: cmView.state.doc.length,
          insert: newContent,
        },
      });
      updatingRef.current = false;
    }
  }, [node.textContent]);

  return (
    <NodeViewWrapper className="code-block-wrapper" data-language={language} data-style={codeBlockStyle}>
      <div className="code-block-header">
        <select
          className="code-block-lang-select"
          value={language}
          onChange={handleLanguageChange}
          contentEditable={false}
        >
          <option value="">auto</option>
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div ref={containerRef} className="code-block-editor" />
    </NodeViewWrapper>
  );
}
