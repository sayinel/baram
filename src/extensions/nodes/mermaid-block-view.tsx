// §5.5 Mermaid Block NodeView — selected: textarea + preview, unselected: SVG render
import { useState, useEffect, useRef, useCallback } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { mermaidBlockEntryKey } from "./mermaid-block";

// Unique ID counter for mermaid rendering
let mermaidIdCounter = 0;

export function MermaidBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const code = (node.attrs.code as string) || "";
  const [localCode, setLocalCode] = useState(code);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");

  // Render Mermaid SVG (async — dynamic import)
  useEffect(() => {
    const source = selected ? localCode : code;
    if (!source.trim()) {
      setSvgHtml("");
      setError(null);
      return;
    }

    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
          securityLevel: "strict",
        });

        const id = `mermaid-${++mermaidIdCounter}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Mermaid rendering error",
          );
        }
      }
    }

    // Debounce rendering while editing
    const timer = setTimeout(render, selected ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [localCode, code, selected]);

  // Sync local code and focus textarea when entering edit mode
  useEffect(() => {
    if (selected) {
      setLocalCode(code);
      const entryState = mermaidBlockEntryKey.getState(editor.state);
      const enteredFromBelow = entryState?.direction === "below";

      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        if (enteredFromBelow) {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        } else {
          ta.setSelectionRange(0, 0);
        }
      }, 0);
    } else {
      // Save on deselect
      if (localCode !== code) {
        updateAttributes({ code: localCode });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Auto-resize textarea
  useEffect(() => {
    if (selected && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
    }
  }, [localCode, selected]);

  const deleteBlock = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const { tr } = editor.state;
    tr.delete(pos, pos + node.nodeSize);
    const $pos = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    tr.setSelection(TextSelection.near($pos, -1));
    editor.view.dispatch(tr);
    editor.view.focus();
  }, [editor, getPos, node.nodeSize]);

  const exitBlock = useCallback(
    (direction: "up" | "down") => {
      const pos = getPos();
      if (typeof pos !== "number") return;

      if (localCode !== code) {
        updateAttributes({ code: localCode });
      }

      if (direction === "up") {
        editor.chain().setTextSelection(pos).focus().run();
      } else {
        const afterPos = pos + node.nodeSize;
        const { doc } = editor.state;
        const $after = doc.resolve(afterPos);
        if ($after.parentOffset >= $after.parent.content.size) {
          editor
            .chain()
            .insertContentAt(afterPos, { type: "paragraph" })
            .setTextSelection(afterPos + 1)
            .focus()
            .run();
        } else {
          editor.chain().setTextSelection(afterPos).focus().run();
        }
      }
    },
    [editor, getPos, localCode, code, updateAttributes, node.nodeSize],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = textareaRef.current;
      if (!ta) return;

      if (e.key === "Escape") {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      if (
        e.key === "Backspace" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0 &&
        !localCode
      ) {
        e.preventDefault();
        deleteBlock();
        return;
      }

      if (
        e.key === "ArrowLeft" &&
        ta.selectionStart === 0 &&
        ta.selectionEnd === 0
      ) {
        e.preventDefault();
        exitBlock("up");
        return;
      }

      if (
        e.key === "ArrowRight" &&
        ta.selectionStart === ta.value.length
      ) {
        e.preventDefault();
        exitBlock("down");
        return;
      }

      if (e.key === "ArrowUp") {
        const before = ta.value.substring(0, ta.selectionStart);
        if (!before.includes("\n")) {
          e.preventDefault();
          exitBlock("up");
          return;
        }
      }

      if (e.key === "ArrowDown") {
        const after = ta.value.substring(ta.selectionStart);
        if (!after.includes("\n")) {
          e.preventDefault();
          exitBlock("down");
          return;
        }
      }
    },
    [exitBlock, deleteBlock, localCode],
  );

  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.commands.setNodeSelection(pos);
  }, [editor, getPos]);

  // Non-editing: SVG render only
  if (!selected) {
    return (
      <NodeViewWrapper
        className="mermaid-block mermaid-block-preview"
        contentEditable={false}
        onClick={handlePreviewClick}
      >
        {svgHtml ? (
          <div
            ref={renderRef}
            className="mermaid-block-svg"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        ) : error ? (
          <div className="mermaid-block-error">{error}</div>
        ) : (
          <div className="mermaid-block-empty">Empty diagram</div>
        )}
      </NodeViewWrapper>
    );
  }

  // Editing: textarea + live preview
  return (
    <NodeViewWrapper
      className="mermaid-block mermaid-block-editing"
      contentEditable={false}
    >
      <div className="mermaid-block-header">
        <span className="mermaid-block-label">mermaid</span>
      </div>
      <textarea
        ref={textareaRef}
        className="mermaid-block-textarea"
        value={localCode}
        onChange={(e) => setLocalCode(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder="flowchart LR&#10;  A --> B"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        data-gramm="false"
      />
      {svgHtml ? (
        <div
          ref={renderRef}
          className={`mermaid-block-svg${error ? " mermaid-block-svg-faded" : ""}`}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      ) : null}
      {error && <div className="mermaid-block-error">{error}</div>}
    </NodeViewWrapper>
  );
}
