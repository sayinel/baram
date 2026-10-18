// §394 spec 0073 D11 ② — open the note a `data-note` link names. Rust decides whether it is a
// note under the block's context (`plugin_note_link`); the shared opener opens it — the same steps
// the backlinks panel takes (select an open tab, else read and open one) plus the §81 context
// switch (plan 0125 P12). Every refusal is one fixed toast badged with the plugin's name (§6).

import type { Locale } from "../../i18n";

import { t } from "../../i18n";
import { pluginNoteLink } from "../../ipc/plugin-invoke";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";

/**
 * `true` when the note is on screen. `context` is the block's `CodeBlockInfo.context` (spec 0073
 * §4): without one there is no root to read `path` against, and Rust is not asked — the command
 * takes a context id (a `null` fails Tauri's argument deserialization), and the one id at hand,
 * the ACTIVE context's, need not be the block's. `source` is the block's `Plugin · {name}`.
 */
export async function openPluginNoteLink(
  context: null | string,
  path: string,
  source: string,
): Promise<boolean> {
  if (context === null) {
    refuse(source);
    return false;
  }
  let target: string;
  try {
    target = await pluginNoteLink(context, path);
  } catch (err) {
    logger.warn(`[PluginBlock] data-note "${path}" refused:`, err);
    refuse(source);
    return false;
  }
  try {
    return (await openFileByPath(target)) === "opened";
  } catch (err) {
    logger.error(`[PluginBlock] opening "${target}" failed:`, err);
    return false;
  }
}

function refuse(source: string): void {
  useUIStore
    .getState()
    .showToast(
      t(
        "plugin.block.noteRefused",
        useSettingsStore.getState().locale as Locale,
      ),
      "warning",
      source,
    );
}
