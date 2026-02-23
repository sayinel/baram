// §6.2 InlineAIPrompt — Floating prompt UI for Cmd+J inline AI editing
// Renders via createPortal at selection position. States: input → streaming → completed.

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Hunk } from "../../extensions/plugins/ai-diff";

export type InlineAIPhase = "input" | "streaming" | "completed";

interface InlineAIPromptProps {
  editor: Editor;
  selectionFrom: number;
  selectionTo: number;
  hasSelection: boolean;
  phase: InlineAIPhase;
  hunks: Hunk[];
  onSubmit: (instruction: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onRegenerate: () => void;
  onAcceptHunk: (index: number) => void;
  onRejectHunk: (index: number) => void;
  onClose: () => void;
}

export function InlineAIPrompt({
  editor,
  selectionFrom,
  phase,
  hunks,
  onSubmit,
  onAccept,
  onReject,
  onRegenerate,
  onAcceptHunk,
  onRejectHunk,
  onClose,
}: InlineAIPromptProps) {
  const [instruction, setInstruction] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  // Position the prompt below the selection
  useEffect(() => {
    try {
      const coords = editor.view.coordsAtPos(selectionFrom);
      const editorRect = editor.view.dom.getBoundingClientRect();
      setPosition({
        top: coords.bottom + 4,
        left: Math.max(coords.left, editorRect.left),
      });
    } catch {
      // Fallback: center horizontally
      setPosition({ top: 100, left: 100 });
    }
  }, [editor, selectionFrom]);

  // Auto-focus input
  useEffect(() => {
    if (phase === "input") {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [phase]);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && phase === "input") {
        e.preventDefault();
        if (instruction.trim()) {
          onSubmit(instruction.trim());
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      // Stop propagation so editor doesn't handle these keys
      e.stopPropagation();
    },
    [instruction, phase, onSubmit, onClose],
  );

  return createPortal(
    <div
      ref={containerRef}
      className="inline-ai-prompt"
      style={{ top: position.top, left: position.left }}
      onKeyDown={handleKeyDown}
    >
      {phase === "input" && (
        <>
          <input
            ref={inputRef}
            className="inline-ai-prompt-input"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Ask AI to edit..."
          />
          <div className="ai-diff-action-bar">
            <button
              className="ai-diff-action-btn ai-diff-action-btn-accept"
              onClick={() => instruction.trim() && onSubmit(instruction.trim())}
              disabled={!instruction.trim()}
            >
              Submit
            </button>
            <button className="ai-diff-action-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      )}

      {phase === "streaming" && (
        <div className="inline-ai-prompt-status">
          <span className="inline-ai-prompt-spinner" />
          <span>Generating...</span>
        </div>
      )}

      {phase === "completed" && (
        <div className="ai-diff-action-bar">
          {hunks.length > 1 && (() => {
            const pendingIndex = hunks.findIndex((h) => !h.accepted && !h.rejected);
            const pendingCount = hunks.filter((h) => !h.accepted && !h.rejected).length;
            const acceptedCount = hunks.filter((h) => h.accepted).length;
            const rejectedCount = hunks.filter((h) => h.rejected).length;
            return (
              <>
                <span className="ai-diff-hunk-status">
                  {pendingCount > 0
                    ? `${pendingCount} pending`
                    : "All decided"}
                  {acceptedCount > 0 && ` / ${acceptedCount} accepted`}
                  {rejectedCount > 0 && ` / ${rejectedCount} rejected`}
                </span>
                <button
                  className="ai-diff-action-btn ai-diff-action-btn-hunk-accept"
                  onClick={() => pendingIndex >= 0 && onAcceptHunk(pendingIndex)}
                  disabled={pendingIndex < 0}
                  title="Accept next pending hunk"
                >
                  Accept Hunk
                </button>
                <button
                  className="ai-diff-action-btn ai-diff-action-btn-hunk-reject"
                  onClick={() => pendingIndex >= 0 && onRejectHunk(pendingIndex)}
                  disabled={pendingIndex < 0}
                  title="Reject next pending hunk"
                >
                  Reject Hunk
                </button>
                <span className="ai-diff-action-separator" />
              </>
            );
          })()}
          <button
            className="ai-diff-action-btn ai-diff-action-btn-accept"
            onClick={onAccept}
          >
            Accept All
          </button>
          <button
            className="ai-diff-action-btn ai-diff-action-btn-reject"
            onClick={onReject}
          >
            Reject All
          </button>
          <button className="ai-diff-action-btn" onClick={onRegenerate}>
            Regenerate
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
