// §56m Frontmatter Tag Bar — NodeView for visual tag editing
import { type KeyboardEvent, useCallback, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

import { useSettingsStore } from "../../stores/settings/store";

// --- YAML tag parsing helpers ---

type TagsFormat = "block" | "inline" | "none";

export function FrontmatterView({ node, editor, getPos }: NodeViewProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tagColors = useSettingsStore((s) => s.tagColors);

  const tags = parseFrontmatterTags(node.textContent);
  const isEditable = editor.isEditable;

  const applyTags = useCallback(
    (newTags: string[]) => {
      const pos = getPos();
      if (typeof pos !== "number") return;
      const newYaml = updateFrontmatterTags(node.textContent, newTags);
      const { tr } = editor.view.state;
      const nodeStart = pos + 1;
      const nodeEnd = pos + node.nodeSize - 1;
      if (newYaml) {
        tr.replaceWith(
          nodeStart,
          nodeEnd,
          editor.view.state.schema.text(newYaml),
        );
      } else {
        tr.delete(nodeStart, nodeEnd);
      }
      editor.view.dispatch(tr);
    },
    [editor, getPos, node],
  );

  const removeTag = useCallback(
    (tag: string) => {
      applyTags(tags.filter((t) => t !== tag));
    },
    [applyTags, tags],
  );

  const addTag = useCallback(
    (raw: string) => {
      const tag = raw.trim().replace(/^#+/, "");
      if (!tag || tags.includes(tag)) return;
      applyTags([...tags, tag]);
      setInputValue("");
    },
    [applyTags, tags],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTag(inputValue);
      } else if (e.key === "Escape") {
        setInputValue("");
        inputRef.current?.blur();
      } else if (
        e.key === "Backspace" &&
        inputValue === "" &&
        tags.length > 0
      ) {
        removeTag(tags[tags.length - 1]);
      }
    },
    [addTag, inputValue, removeTag, tags],
  );

  const handleTagClick = useCallback((tag: string) => {
    window.dispatchEvent(
      new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
    );
  }, []);

  // Hide tag bar in read-only mode with no tags
  const showTagBar = isEditable || tags.length > 0;

  return (
    <NodeViewWrapper
      className="frontmatter"
      data-type="frontmatter"
      spellCheck={false}
    >
      <NodeViewContent className="frontmatter-code" />
      {showTagBar && (
        <div className="fm-tag-bar" contentEditable={false}>
          <span className="fm-tag-label">Tags</span>
          {tags.map((tag) => {
            const pillColor = tagColors[tag];
            return (
              <span
                className="fm-tag-pill"
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={
                  pillColor
                    ? { color: pillColor, borderColor: pillColor }
                    : undefined
                }
                title={`Search for #${tag}`}
              >
                #{tag}
                {isEditable && (
                  <button
                    aria-label={`Remove tag ${tag}`}
                    className="fm-tag-pill-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                    title="Remove tag"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
          {isEditable && (
            <input
              aria-label="Add tag"
              className="fm-tag-input"
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add tag..."
              ref={inputRef}
              value={inputValue}
            />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Parses the `tags:` field from a YAML frontmatter string.
 * Supports:
 *   tags: [tag1, tag2]       (inline array)
 *   tags:\n  - tag1\n  - tag2  (block list)
 */
// eslint-disable-next-line react-refresh/only-export-components
export function parseFrontmatterTags(yaml: string): string[] {
  // Inline array: tags: [tag1, "tag 2", tag3]
  const inlineMatch = yaml.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  // Block list: tags:\n  - tag1\n  - tag2
  const blockMatch = yaml.match(/^tags:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)/m);
  if (blockMatch) {
    return blockMatch[1]
      .split("\n")
      .map((line) => line.match(/^[ \t]+-[ \t]+(.+)$/)?.[1]?.trim() ?? "")
      .filter(Boolean);
  }

  return [];
}

/**
 * Rewrites the `tags:` section in YAML with new tags, preserving the original format.
 * If no tags field exists, appends `tags: [...]` after the first line.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function updateFrontmatterTags(yaml: string, tags: string[]): string {
  const format = detectTagsFormat(yaml);

  if (format === "inline") {
    const inlineValue = `[${tags.join(", ")}]`;
    return yaml.replace(/^tags:\s*\[[^\]]*\]/m, `tags: ${inlineValue}`);
  }

  if (format === "block") {
    const blockValue = "\n" + tags.map((t) => `  - ${t}`).join("\n");
    return yaml.replace(
      /^tags:\s*\n((?:[ \t]+-[ \t]+\S[^\n]*\n?)+)/m,
      `tags:${blockValue}\n`,
    );
  }

  // No tags field — append after first line
  const lines = yaml.split("\n");
  lines.splice(1, 0, `tags: [${tags.join(", ")}]`);
  return lines.join("\n");
}

// --- NodeView component ---

function detectTagsFormat(yaml: string): TagsFormat {
  if (/^tags:\s*\[/m.test(yaml)) return "inline";
  if (/^tags:\s*\n(?:[ \t]+-[ \t]+\S)/m.test(yaml)) return "block";
  return "none";
}
