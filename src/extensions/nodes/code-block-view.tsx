// §5.4 CodeMirror 6 NodeView for Code Blocks
import { useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle, indentUnit } from "@codemirror/language";
import { getLanguageExtension, LANGUAGE_OPTIONS } from "./code-block-languages";
import { useSettingsStore } from "../../stores/settings-store";

export function CodeBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const language = (node.attrs.language as string) || "";
  const tabSize = useSettingsStore((s) => s.tabSize);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value || null });
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    let destroyed = false;

    // §8.4 Language extensions are loaded asynchronously to reduce initial bundle
    async function initEditor() {
      const langExt = await getLanguageExtension(language);
      if (destroyed || !containerRef.current) return;

      const currentTabSize = useSettingsStore.getState().tabSize;
      const extensions = [
        keymap.of([...defaultKeymap, indentWithTab]),
        lineNumbers(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping,
        EditorState.tabSize.of(currentTabSize),
        indentUnit.of(" ".repeat(currentTabSize)),
        EditorState.readOnly.of(!extension.options.editable),
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
    }

    initEditor();

    return () => {
      destroyed = true;
      if (cmViewRef.current) {
        cmViewRef.current.destroy();
        cmViewRef.current = null;
      }
    };
    // Recreate when language or tabSize changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, tabSize]);

  return (
    <NodeViewWrapper className="code-block-wrapper" data-language={language}>
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
