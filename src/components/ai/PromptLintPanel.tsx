// §46 Prompt Lint Suggestions Panel — displays lint issues with click-to-navigate
import { useState, useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { getPromptLintResults } from "../../extensions/plugins/prompt-lint";
import type { PmLintResult } from "../../extensions/plugins/prompt-lint";
import { TextSelection } from "@tiptap/pm/state";

interface PromptLintPanelProps {
  editor: Editor | null;
}

export function PromptLintPanel({ editor }: PromptLintPanelProps) {
  const [results, setResults] = useState<PmLintResult[]>([]);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      setResults(getPromptLintResults(editor.state));
    };

    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  if (results.length === 0) return null;

  const handleClick = (result: PmLintResult) => {
    if (!editor) return;
    try {
      const { tr } = editor.state;
      const pos = Math.min(result.pmFrom, editor.state.doc.content.size);
      const resolvedPos = editor.state.doc.resolve(pos);
      tr.setSelection(TextSelection.near(resolvedPos));
      tr.scrollIntoView();
      editor.view.dispatch(tr);
      editor.view.focus();
    } catch {
      // Position may be invalid
    }
  };

  return (
    <div className="prompt-lint-panel">
      <div className="prompt-lint-header">
        <span className="prompt-lint-title">Prompt Issues</span>
        <span className="prompt-lint-count">{results.length}</span>
      </div>
      <div className="prompt-lint-list">
        {results.map((r, i) => (
          <button
            key={`${r.rule}-${r.pmFrom}-${i}`}
            className={`prompt-lint-item prompt-lint-item-${r.severity}`}
            onClick={() => handleClick(r)}
          >
            <span className="prompt-lint-severity-icon">
              {r.severity === "error" ? "\u25CF" : "\u25B2"}
            </span>
            <span className="prompt-lint-message">{r.message}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
