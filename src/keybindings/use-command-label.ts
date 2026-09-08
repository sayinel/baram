// A command's name with its live chord — `굵게 (⌘B)`.
//
// ‼️ The registry owns BOTH halves. Spelling either into a component duplicates a value that
// lives somewhere else: the floating toolbar said `Bold (Cmd+B)` and the table toolbar
// `Merge Cells (⌘M)` — correct on macOS, wrong on every other platform, where those chords
// are `Ctrl+B` and `Ctrl+M`. `formatKeyForDisplay` already knows the difference; the literals
// did not. So neither half is written by a caller: the name comes from `entry.label` through
// `t()`, the chord from `entry.activeKey` through `formatKeyForDisplay`.
//
// ‼️ `ActivityBar` composes the same two halves but does NOT use this hook, and that is
// deliberate — its icons are named by their own keys (`settings.activitybar.item.chat` =
// "AI 채팅"), not by the command's (`keybindings.ai.chatPanel` = "AI 채팅 패널"). Routing it
// through here would silently rename the rail. It takes only the CHORD from the registry,
// which is the half a rebind can change.
import { useCallback } from "react";

import { useTranslation } from "../i18n/useTranslation";
import { formatKeyForDisplay } from "./key-utils";
import { useKeybindings } from "./use-keybindings";

/** `(commandId) => "굵게 (⌘B)"`, or just the name when the command has no chord. */
export type CommandLabel = (commandId: string) => string;

/**
 * Label a button by the command it runs.
 *
 * An id with no registry entry falls back to the id itself rather than throwing — a chrome
 * component must still render. That fallback is why the ids callers pass are guarded, and the
 * guard is `components/toolbar/__tests__/toolbar-i18n.test.tsx`: its prose scan dismisses a
 * command-id literal only when the id is IN the registry (the dismissal set is derived from
 * `KEYBINDING_REGISTRY`), so a typo stays a reported string instead of shipping as a button
 * labelled `formatting.bold`. Derived rather than enumerated on purpose — a hand-written list
 * of "ids the toolbar passes" would cover the calls it happened to name and let the next one
 * through.
 */
export function useCommandLabel(): CommandLabel {
  const { t } = useTranslation();
  const keybindings = useKeybindings();
  const isMac = navigator.platform.includes("Mac");

  return useCallback(
    (commandId: string) => {
      const entry = keybindings.find((k) => k.id === commandId);
      if (!entry) return commandId;
      const name = t(entry.label);
      return `${name} (${formatKeyForDisplay(entry.activeKey, isMac)})`;
    },
    [keybindings, isMac, t],
  );
}
