// §56m Frontmatter Tag Bar — NodeView for visual tag editing
import { type KeyboardEvent, useCallback, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { X } from "lucide-react";

import { Tooltip } from "../../components/Tooltip";
import { useEditorChrome } from "../../hooks/use-editor-chrome";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  frontmatterListItems,
  writeFrontmatterList,
} from "../../utils/markdown/frontmatter-list";
import { isBodyTagName, tagName } from "../../utils/tags/tag-name";
import {
  canUseEditorChrome,
  withVimExternalEdit,
} from "../plugins/vim/vim-keys";

// --- YAML tag parsing helpers ---

/** §12-⑩/§5b provenance: the remove pill is NodeView chrome (tagged); the
 *  input is a focus-local island under data-vim-suspend (untagged). */
type TagMutationOrigin = "chrome" | "island";

export function FrontmatterView({ node, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tagColors = useSettingsStore((s) => s.tagColors);

  const tags = parseFrontmatterTags(node.textContent);
  // §12-⑩: NOT editor.isEditable — that hides the tag UI during vim normal,
  // and a bare render read goes stale (ReactNodeView skips re-render on
  // unchanged nodes).
  const canEdit = useEditorChrome(editor);

  /** Whether the edit was dispatched — `false` leaves the front matter as it was. */
  const applyTags = useCallback(
    (newTags: string[], origin: TagMutationOrigin): boolean => {
      // §12-⑩ event-time guard: this callback can fire from stale-rendered
      // UI after capability was revoked — the render gate is not enough.
      if (!canUseEditorChrome(editor)) return false;
      const pos = getPos();
      if (typeof pos !== "number") return false;
      const newYaml = updateFrontmatterTags(node.textContent, newTags);
      // A `tags:` field the bar cannot rewrite comes back unchanged — say so, rather than
      // ignore the click.
      if (newYaml === node.textContent) {
        useUIStore
          .getState()
          .showToast(t("frontmatter.tagsNotEditable"), "info");
        return false;
      }
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
      if (origin === "chrome") withVimExternalEdit(tr);
      editor.view.dispatch(tr);
      return true;
    },
    [editor, getPos, node, t],
  );

  const removeTag = useCallback(
    (tag: string, origin: TagMutationOrigin) => {
      applyTags(
        tags.filter((t) => t !== tag),
        origin,
      );
    },
    [applyTags, tags],
  );

  const addTag = useCallback(
    (raw: string) => {
      const tag = tagName(raw.trim());
      if (tag === "" || tags.includes(tag)) return;
      if (!isBodyTagName(tag)) {
        useUIStore
          .getState()
          .showToast(t("journal.capture.error.tagName", { tag }), "info");
        return;
      }
      // The typed text stays when nothing was written, rather than vanish as if it had been.
      if (applyTags([...tags, tag], "island")) setInputValue("");
    },
    [applyTags, t, tags],
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
        removeTag(tags[tags.length - 1], "island");
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
  const showTagBar = canEdit || tags.length > 0;

  return (
    <NodeViewWrapper
      className="frontmatter"
      data-type="frontmatter"
      spellCheck={false}
    >
      <NodeViewContent className="frontmatter-code" />
      {showTagBar && (
        <div className="fm-tag-bar" contentEditable={false}>
          <span className="fm-tag-label">{t("frontmatter.tags")}</span>
          {tags.map((tag) => {
            const pillColor = tagColors[tag];
            return (
              <Tooltip
                key={tag}
                label={t("frontmatter.searchTag", { tag })}
                placement="bottom"
              >
                <span
                  className="fm-tag-pill"
                  onClick={() => handleTagClick(tag)}
                  style={
                    pillColor
                      ? { color: pillColor, borderColor: pillColor }
                      : undefined
                  }
                >
                  #{tag}
                  {canEdit && (
                    <Tooltip
                      label={t("frontmatter.removeTagOf", { tag })}
                      placement="bottom"
                    >
                      <button
                        className="fm-tag-pill-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTag(tag, "chrome");
                        }}
                      >
                        <X className="icon-inline" size="1em" />
                      </button>
                    </Tooltip>
                  )}
                </span>
              </Tooltip>
            );
          })}
          {canEdit && (
            <input
              aria-label={t("frontmatter.addTag")}
              className="fm-tag-input"
              data-vim-suspend=""
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("frontmatter.addTagPlaceholder")}
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
 * The tag names in the `tags:` lists of a YAML frontmatter string (without its `---` fences),
 * once each — a pill per tag. A name is the item's value without its leading `#`s (`tagName`),
 * so `"#solo"` and `solo` are the one pill `#solo`. The lists are read as the tag index reads
 * them (`frontmatterListItems`):
 *   tags: [tag1, tag2]       (inline array)
 *   tags:\n  - tag1\n  - tag2  (block list, indented or not)
 */
// eslint-disable-next-line react-refresh/only-export-components
export function parseFrontmatterTags(yaml: string): string[] {
  const names = frontmatterListItems(yaml, "tags").map((i) => tagName(i.value));
  return [...new Set(names.filter(Boolean))];
}

/**
 * Rewrites the `tags:` list to hold the tag names `tags` (`writeFrontmatterList`): only the
 * items and lines an edit touches change; without a `tags:` key, `tags: [...]` is appended at
 * the end; a `tags:` field the writer cannot rewrite in place comes back unchanged.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function updateFrontmatterTags(yaml: string, tags: string[]): string {
  return writeFrontmatterList(yaml, "tags", tags, tagName);
}
