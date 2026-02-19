// §30c Block Embed NodeView — renders {{embed ((target#^blockId))}} as read-only preview
import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { BlockEmbedOptions } from "./block-embed";
import { resolveWikilinkTarget } from "../../utils/wikilink-nav";
import { findBlockContent } from "../../utils/block-nav";
import { useFileStore } from "../../stores/file-store";
import { readFile } from "../../ipc/invoke";

export function BlockEmbedView({ node, selected, extension, editor }: NodeViewProps) {
  const { target, blockId } = node.attrs as {
    target: string;
    blockId: string;
  };

  const [content, setContent] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");

  // Load block content
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");

      try {
        let fileContent: string;

        if (!target) {
          // Same file — get content from current editor
          const { prosemirrorToMarkdown } = await import("../../pipeline/pm-to-md");
          fileContent = prosemirrorToMarkdown(editor.state.doc);
        } else {
          // Different file — resolve and read
          const resolved = resolveWikilinkTarget(target);
          if (!resolved) {
            if (!cancelled) {
              setContent(null);
              setStatus("not-found");
            }
            return;
          }

          // Cache-first
          const cached = useFileStore.getState().openFiles.get(resolved.path);
          if (cached !== undefined) {
            fileContent = cached;
          } else {
            fileContent = await readFile(resolved.path);
          }
        }

        if (cancelled) return;

        const blockText = findBlockContent(fileContent, blockId);
        if (blockText !== null) {
          setContent(blockText);
          setStatus("ready");
        } else {
          setContent(null);
          setStatus("not-found");
        }
      } catch {
        if (!cancelled) {
          setContent(null);
          setStatus("error");
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [target, blockId, editor]);

  // Navigate to source on header click
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const onNavigate = (extension.options as BlockEmbedOptions).onNavigate;
      onNavigate(target, blockId);
    },
    [extension, target, blockId],
  );

  const headerText = target ? `${target} > ^${blockId}` : `^${blockId}`;

  return (
    <NodeViewWrapper
      className={`block-embed ${selected ? "block-embed-selected" : ""}`}
    >
      <div className="block-embed-header" onClick={handleHeaderClick}>
        {headerText}
      </div>
      <div className="block-embed-content">
        {status === "loading" && (
          <span style={{ color: "var(--color-text-muted)" }}>Loading…</span>
        )}
        {status === "ready" && content}
        {status === "not-found" && (
          <span style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>
            Block ^{blockId} not found
          </span>
        )}
        {status === "error" && (
          <span style={{ color: "#dc2626", fontStyle: "italic" }}>
            Failed to load embed
          </span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
