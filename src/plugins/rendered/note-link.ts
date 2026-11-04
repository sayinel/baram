// §394 spec 0073 D11 ② — open the note a `data-note` link names. Rust (`plugin_note_link`) decides
// whether it is a note under the context it is given (a block's, or for a panel the active one); the
// shared opener opens it — the same steps the backlinks panel takes (select an open tab, else read
// and open one) plus the §81 context switch (plan 0125 P12). Every refusal is one fixed toast badged
// with the plugin's name (§6).

import type { Locale } from "../../i18n";

import { t } from "../../i18n";
import { pluginNoteLink } from "../../ipc/plugin-invoke";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { openFileByPath } from "../../utils/open-file";

/**
 * `true` when the note is on screen. `context` is the context `path` is relative to: a block's
 * `CodeBlockInfo.context` (spec 0073 §4), or, for a sandboxed panel — which belongs to no note — the
 * context active at the click (plan 0126 P7). `null` — a block in no context, or no active context —
 * is refused without asking Rust, showing the toast and logging nothing: the command takes a context
 * id (a `null` fails Tauri's argument deserialization), and for a block the one id at hand, the
 * ACTIVE context's, need not be the block's. `source` is the area's `Plugin · {name}`. A refusal from
 * the IPC (`plugin_note_link`) is logged under `[PluginBlock]`, for a panel too — the log prefix is
 * this module's, not the area's.
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
