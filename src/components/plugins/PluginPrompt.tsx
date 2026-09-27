// §385 The prompt's contents (spec 0061 §8): a quick pick (filter + ranked list) or an input box.
// Mounted by show-plugin-prompt.tsx, which owns focus, occlusion and settling; this owns keys
// and rendering. The box, input and rows reuse the command palette's classes.
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useId, useMemo, useRef, useState } from "react";

import { useTranslation } from "../../i18n/useTranslation";
import { PROMPT_LIMITS } from "../../plugins/sandbox/protocol";
import { usePaletteListNav } from "../command/use-palette-list-nav";
import { prepareItems, type RankedItem, rankItems } from "./prompt-rank";

export type PromptSpec =
  | {
      items: RankedItem[];
      kind: "quickPick";
      placeholder?: string;
      title?: string;
    }
  | { kind: "inputBox"; placeholder?: string; title?: string; value?: string };

interface PluginPromptProps {
  onCancel: () => void;
  onSubmit: (value: string) => void;
  /** The plugin's display name, already through `pluginSourceLabel`. */
  source: string;
  spec: PromptSpec;
}

/**
 * Keys the prompt acts on. `stopPropagation()` below stops these at its root, so a BUBBLE-phase
 * listener further up the page does not act on them too — a capture-phase listener above still
 * sees the key regardless (spec 0061 §8), the same as `prompt-gate.ts`'s own watcher does.
 */
const HANDLED_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "Enter",
  "Escape",
  "Tab",
]);

export function PluginPrompt({
  onCancel,
  onSubmit,
  source,
  spec,
}: PluginPromptProps) {
  const { t } = useTranslation();
  const listId = useId();
  const headerId = useId();
  const [text, setText] = useState(
    spec.kind === "inputBox" ? (spec.value ?? "") : "",
  );
  const [overLimit, setOverLimit] = useState(false);
  // A held key auto-repeats into a prompt that opened under it: Enter held after launching from
  // the palette would pick row 0 (spec 0061 §8). Repeats count only once a fresh key was pressed.
  const freshKeySeen = useRef(false);
  const prepared = useMemo(
    () => (spec.kind === "quickPick" ? prepareItems(spec.items) : []),
    [spec],
  );
  const rows = useMemo(
    () => rankItems(text, prepared, PROMPT_LIMITS.rows),
    [text, prepared],
  );
  const nav = usePaletteListNav({
    isOpen: true,
    itemCount: rows.length,
    onEnter: (index) => onSubmit(rows[index].id),
    onEscape: onCancel,
  });

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.repeat && !freshKeySeen.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!event.repeat) freshKeySeen.current = true;
    if (isComposing(event)) return;
    if (!HANDLED_KEYS.has(event.key)) return;
    event.stopPropagation();
    if (event.key === "Tab") {
      // The input is the only focusable thing inside; Tab must not walk out behind the overlay.
      event.preventDefault();
      return;
    }
    if (spec.kind === "quickPick") {
      nav.handleKeyDown(event);
      return;
    }
    // The input box handles Enter itself: the list hook only calls `onEnter` for an index below
    // `itemCount`, which is 0 here (spec 0061 §8).
    event.preventDefault();
    if (event.key === "Escape") onCancel();
    else if (event.key === "Enter") {
      if (text.length > PROMPT_LIMITS.valueChars) setOverLimit(true);
      else onSubmit(text);
    }
  };

  const quickPick = spec.kind === "quickPick";
  return (
    <div
      aria-labelledby={headerId}
      aria-modal="true"
      className="command-palette plugin-prompt"
      onKeyDown={onKeyDown}
      role="dialog"
    >
      <div className="plugin-prompt-header" id={headerId}>
        <span className="plugin-prompt-source">
          {t("plugin.prompt.source", { name: source })}
        </span>
        {spec.title ? (
          <span className="plugin-prompt-title">{spec.title}</span>
        ) : null}
      </div>
      <input
        aria-activedescendant={
          quickPick && rows.length > 0
            ? `${listId}-${nav.selectedIndex}`
            : undefined
        }
        aria-controls={quickPick ? listId : undefined}
        aria-expanded={quickPick ? true : undefined}
        aria-labelledby={headerId}
        className="command-palette-input plugin-prompt-input"
        maxLength={quickPick ? undefined : PROMPT_LIMITS.valueChars}
        onChange={(event) => {
          setText(event.target.value);
          setOverLimit(false);
          nav.setSelectedIndex(0);
        }}
        placeholder={spec.placeholder}
        role={quickPick ? "combobox" : undefined}
        spellCheck={false}
        type="text"
        value={text}
      />
      {quickPick ? (
        <div
          aria-label={t("plugin.prompt.list")}
          className="command-palette-list"
          id={listId}
          role="listbox"
        >
          {rows.length === 0 ? (
            <div className="command-palette-empty">
              {t("plugin.prompt.empty")}
            </div>
          ) : (
            rows.map((item, index) => (
              <div
                aria-selected={index === nav.selectedIndex}
                className={`command-palette-item ${index === nav.selectedIndex ? "command-palette-item-selected" : ""}`}
                id={`${listId}-${index}`}
                key={item.id}
                onClick={() => onSubmit(item.id)}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => nav.setSelectedIndex(index)}
                role="option"
              >
                <span className="command-item-label">{item.label}</span>
                {item.description ? (
                  <span className="plugin-prompt-description">
                    {item.description}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
      {overLimit ? (
        <div className="plugin-prompt-limit" role="alert">
          {t("plugin.prompt.tooLong", {
            max: String(PROMPT_LIMITS.valueChars),
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A key the IME is still composing with — Enter then commits a syllable, and Esc during
 * Japanese or Chinese conversion must not cancel the prompt (and with it the flow, D4).
 * Copied from `SymbolPicker.tsx`, where it is module-private (plan 0109 P7).
 */
function isComposing(event: ReactKeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
