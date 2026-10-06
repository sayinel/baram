// §391 spec 0070 §8 — what the capture row says about the key just pressed: who has it, and —
// for the stored key of a plugin command that is not in the list — that confirming removes it.
import type { Translate } from "../../../i18n/useTranslation";
import type { KeybindingConflict } from "../../../keybindings/use-keybindings";

import { keybindingLabel } from "../../../keybindings/plugin-keybindings";
import {
  MAX_SOURCE_CHARS,
  sanitizePluginText,
} from "../../../plugins/plugin-text";

export function KeybindingConflictNote({
  conflict,
  refused,
  t,
}: {
  conflict: KeybindingConflict;
  refused: boolean;
  t: Translate;
}) {
  if (conflict.kind === "absent") {
    // Plan 0118 P10 — for a core target and a plugin target alike: confirming removes a key the
    // user cannot see anywhere in the list.
    return (
      <span className="keybinding-conflict">
        {t("keybindings.conflict.absent", {
          plugin: sanitizePluginText(conflict.pluginId, MAX_SOURCE_CHARS),
        })}{" "}
        {t("keybindings.conflict.absentRemoves")}
      </span>
    );
  }
  // D13 — a plugin target meeting a core command's key is refused, and the note says so.
  const template = t(
    refused ? "keybindings.conflict.core" : "keybindings.conflict",
  );
  const label = keybindingLabel(conflict.entry, t);
  // A function replacer (plan 0118 P13): a plugin title is text, and a string replacement
  // would read `$&` in it as a pattern.
  return (
    <span className="keybinding-conflict">
      {template.replace("{command}", () => label)}
    </span>
  );
}
