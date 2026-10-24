// §56m Frontmatter Tag Bar — NodeView for visual tag editing
import { type KeyboardEvent, useCallback, useRef, useState } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { X } from "lucide-react";

import { Tooltip } from "../../components/Tooltip";
import { useEditorChrome } from "../../hooks/use-editor-chrome";
import { useTranslation } from "../../i18n/useTranslation";
import { useSettingsStore } from "../../stores/settings/store";
import {
  flowList,
  listItemSpelling,
  readFrontmatterList,
} from "../../utils/markdown/frontmatter-list";
import { tagName } from "../../utils/tags/tag-name";
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
      // A `tags:` field the bar cannot rewrite comes back unchanged.
      if (newYaml === node.textContent) return false;
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
    [editor, getPos, node],
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
      if (!tag || tags.includes(tag)) return;
      // The typed text stays when nothing was written, rather than vanish as if it had been.
      if (applyTags([...tags, tag], "island")) setInputValue("");
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
 * The tag names in the `tags:` field of a YAML frontmatter string (without its `---` fences),
 * once each — a pill per tag. A name is the item's value without quotes and without its leading
 * `#`s (`tagName`), so `"#solo"` and `solo` are the one pill `#solo`.
 * Supports, as `readFrontmatterList` reads them:
 *   tags: [tag1, tag2]       (inline array)
 *   tags:\n  - tag1\n  - tag2  (block list, indented or not)
 */
// eslint-disable-next-line react-refresh/only-export-components
export function parseFrontmatterTags(yaml: string): string[] {
  const items = readFrontmatterList(yaml, "tags")?.items ?? [];
  return [...new Set(items.map((i) => tagName(i.value)).filter(Boolean))];
}

/**
 * Rewrites the `tags:` field to hold the tag names `tags`, in its own form (inline or block)
 * and under its own key spelling. The items of a name that stays are kept as written — quotes,
 * `#` and block indentation — and quoted only when YAML could not read them; a new name is
 * quoted when YAML would not read it back as written (`listItemSpelling`). An emptied list is
 * written `tags: []`. Without a `tags:` field, `tags: [...]` goes after the first line. A
 * `tags:` this cannot read as a list (a scalar, a flow list over several lines) is left alone
 * and `yaml` is returned unchanged: writing a list beside it would repeat the key, and over its
 * first line would strand the rest.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function updateFrontmatterTags(yaml: string, tags: string[]): string {
  const list = readFrontmatterList(yaml, "tags");
  if (!list) {
    if (/^tags[ \t]*:/im.test(yaml)) return yaml;
    const lines = yaml.split("\n");
    lines.splice(1, 0, `tags: ${flowList(tags)}`);
    return lines.join("\n");
  }

  const wanted = new Set(tags);
  const kept = list.items.filter((i) => wanted.has(tagName(i.value)));
  const present = new Set(kept.map((i) => tagName(i.value)));
  const added = tags.filter((t) => !present.has(t));

  let field: string;
  if (list.form === "inline" || kept.length + added.length === 0) {
    field = `${list.key} ${flowList([...kept, ...added])}`;
  } else {
    const lead = list.items[0]?.lead ?? "  - ";
    field = [
      list.key,
      ...kept.map((i) => `${i.lead ?? lead}${listItemSpelling(i, false)}`),
      ...added.map((t) => `${lead}${listItemSpelling(t, false)}`),
    ].join("\n");
  }
  return yaml.slice(0, list.start) + field + yaml.slice(list.end);
}
