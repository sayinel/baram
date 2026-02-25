// §5.5 Mermaid Block NodeView — selected: textarea + preview, unselected: SVG render
// §50 Enhanced: template picker + full-screen edit
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { mermaidBlockEntryKey } from "./mermaid-block";
import {
  MERMAID_TEMPLATES,
  detectMermaidType,
} from "../../utils/mermaid-utils";

// Unique ID counter for mermaid rendering
let mermaidIdCounter = 0;

/** Shared rendering logic */
async function renderMermaid(
  source: string,
  onSuccess: (svg: string) => void,
  onError: (msg: string) => void,
): Promise<void> {
  if (!source.trim()) {
    onSuccess("");
    return;
  }
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme:
        document.documentElement.dataset.theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
    const id = `mermaid-${++mermaidIdCounter}`;
    const { svg } = await mermaid.render(id, source);
    onSuccess(svg);
  } catch (err) {
    onError(err instanceof Error ? err.message : "Mermaid rendering error");
  }
}

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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenCode, setFullscreenCode] = useState("");
  const [fullscreenSvg, setFullscreenSvg] = useState("");
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const fullscreenTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Render Mermaid SVG (async — dynamic import)
  useEffect(() => {
    const source = selected ? localCode : code;
    if (!source.trim()) {
      setSvgHtml("");
      setError(null);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(() => {
      renderMermaid(
        source,
        (svg) => {
          if (!cancelled) {
            setSvgHtml(svg);
            setError(null);
          }
        },
        (msg) => {
          if (!cancelled) setError(msg);
        },
      );
    }, selected ? 300 : 0);

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
      setShowTemplates(false);
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

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (wrapper && !wrapper.querySelector(".mermaid-template-wrapper")?.contains(e.target as Node)) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates]);

  // Listen for fullscreen custom event from context menu
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = () => {
      setFullscreenCode(localCode || code);
      setFullscreenSvg(svgHtml);
      setFullscreenError(error);
      setFullscreen(true);
    };
    wrapper.addEventListener("mermaid-fullscreen", handler);
    return () => wrapper.removeEventListener("mermaid-fullscreen", handler);
  }, [localCode, code, svgHtml, error]);

  // Fullscreen rendering
  useEffect(() => {
    if (!fullscreen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      renderMermaid(
        fullscreenCode,
        (svg) => {
          if (!cancelled) {
            setFullscreenSvg(svg);
            setFullscreenError(null);
          }
        },
        (msg) => {
          if (!cancelled) setFullscreenError(msg);
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fullscreenCode, fullscreen]);

  // Auto-resize fullscreen textarea
  useEffect(() => {
    if (fullscreen && fullscreenTextareaRef.current) {
      fullscreenTextareaRef.current.style.height = "auto";
      fullscreenTextareaRef.current.style.height =
        fullscreenTextareaRef.current.scrollHeight + "px";
    }
  }, [fullscreenCode, fullscreen]);

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

  const applyTemplate = useCallback(
    (key: string) => {
      const template = MERMAID_TEMPLATES[key];
      if (!template) return;
      setLocalCode(template.code);
      setShowTemplates(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [],
  );

  const closeFullscreen = useCallback(() => {
    // Save fullscreen changes back
    setLocalCode(fullscreenCode);
    updateAttributes({ code: fullscreenCode });
    setFullscreen(false);
  }, [fullscreenCode, updateAttributes]);

  const detectedType = detectMermaidType(localCode);

  // Fullscreen edit modal
  const fullscreenModal = fullscreen
    ? createPortal(
        <div
          className="mermaid-fullscreen-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeFullscreen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeFullscreen();
          }}
        >
          <div className="mermaid-fullscreen-modal">
            <div className="mermaid-fullscreen-header">
              <span className="mermaid-block-label">mermaid</span>
              {detectedType && (
                <span className="mermaid-fullscreen-type">
                  {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
                </span>
              )}
              <button
                className="mermaid-fullscreen-close"
                onClick={closeFullscreen}
              >
                Close
              </button>
            </div>
            <div className="mermaid-fullscreen-body">
              <div className="mermaid-fullscreen-editor">
                <textarea
                  ref={fullscreenTextareaRef}
                  className="mermaid-block-textarea"
                  value={fullscreenCode}
                  onChange={(e) => setFullscreenCode(e.target.value)}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  data-gramm="false"
                  autoFocus
                />
              </div>
              <div className="mermaid-fullscreen-preview">
                {fullscreenSvg ? (
                  <div
                    className={`mermaid-block-svg${fullscreenError ? " mermaid-block-svg-faded" : ""}`}
                    dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
                  />
                ) : null}
                {fullscreenError && (
                  <div className="mermaid-block-error">{fullscreenError}</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // Non-editing: SVG render only
  if (!selected) {
    return (
      <NodeViewWrapper
        ref={wrapperRef}
        className="mermaid-block mermaid-block-preview"
        data-type="mermaidBlock"
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
        {fullscreenModal}
      </NodeViewWrapper>
    );
  }

  // Editing: textarea + live preview
  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="mermaid-block mermaid-block-editing"
      data-type="mermaidBlock"
      contentEditable={false}
    >
      <div className="mermaid-block-header">
        <span className="mermaid-block-label">mermaid</span>
        {detectedType && (
          <span className="mermaid-block-type-badge">
            {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
          </span>
        )}
        <div className="mermaid-block-actions">
          <div className="mermaid-template-wrapper">
            <button
              className="mermaid-template-btn"
              onClick={() => setShowTemplates(!showTemplates)}
              title="Diagram templates"
            >
              Template ▾
            </button>
            {showTemplates && (
              <div className="mermaid-template-dropdown">
                {Object.entries(MERMAID_TEMPLATES).map(([key, tmpl]) => (
                  <button
                    key={key}
                    className={`mermaid-template-dropdown-item${detectedType === key ? " mermaid-template-active" : ""}`}
                    onClick={() => applyTemplate(key)}
                  >
                    {tmpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="mermaid-fullscreen-btn"
            onClick={() => {
              setFullscreenCode(localCode);
              setFullscreenSvg(svgHtml);
              setFullscreenError(error);
              setFullscreen(true);
            }}
            title="Edit full-screen"
          >
            Expand
          </button>
        </div>
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
      {fullscreenModal}
    </NodeViewWrapper>
  );
}
