// §5.4 CodeMirror 6 NodeView for Code Blocks
import { useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper, NodeViewProps } from "@tiptap/react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { getLanguageExtension } from "./code-block-languages";

export function CodeBlockView({ node, updateAttributes, extension }: NodeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cmViewRef = useRef<EditorView | null>(null);
  const language = (node.attrs.language as string) || "";

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value || null });
    },
    [updateAttributes],
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const langExt = getLanguageExtension(language);
    const extensions = [
      keymap.of([...defaultKeymap, indentWithTab]),
      lineNumbers(),
      drawSelection(),
      bracketMatching(),
      EditorView.lineWrapping,
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

    return () => {
      view.destroy();
      cmViewRef.current = null;
    };
    // Only recreate when language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

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
          <option value="javascript">JavaScript</option>
          <option value="typescript">TypeScript</option>
          <option value="python">Python</option>
          <option value="rust">Rust</option>
          <option value="go">Go</option>
          <option value="java">Java</option>
          <option value="c">C</option>
          <option value="cpp">C++</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
          <option value="json">JSON</option>
          <option value="yaml">YAML</option>
          <option value="markdown">Markdown</option>
          <option value="sql">SQL</option>
          <option value="xml">XML</option>
          <option value="shell">Shell</option>
          <option value="php">PHP</option>
          <option value="ruby">Ruby</option>
          <option value="swift">Swift</option>
          <option value="kotlin">Kotlin</option>
          <option value="latex">LaTeX</option>
        </select>
      </div>
      <div ref={containerRef} className="code-block-editor" />
    </NodeViewWrapper>
  );
}
