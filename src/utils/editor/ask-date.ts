// §316 Ask the user for a date, with a calendar attached.
//
// One entry point for every surface that needs a date typed OR picked. The
// calendar itself lives in `utils/date-picker.ts` and is attached by
// `field-dialog`'s `type: "date"`; what this adds is the half both callers
// would otherwise copy — routing the answer through `resolveDateInput` so the
// accepted vocabulary (`+3`, `t`, `9/30`, `today`) is the same everywhere, and
// reporting an unparseable answer the same way.
import type { Locale } from "../../i18n";

import { t } from "../../i18n";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { showFieldDialog } from "../field-dialog";
import { resolveDateInput } from "../tasks/task-date-input";

export interface AskDateOptions {
  /**
   * Whether submitting a blank input is meaningful. A task field reads it as
   * "clear this field" and gets `""`; a surface that INSERTS something has
   * nothing to express with a blank, so it gets `null` (do nothing) instead.
   */
  allowEmpty?: boolean;
  label: string;
  submitLabel?: string;
  title: string;
  /** Pre-filled value — an editing dialog must open holding the current one. */
  value?: string;
}

/**
 * Returns an ISO date, `""` when cleared (only with `allowEmpty`), or `null`
 * when the user cancelled or typed something no date vocabulary accepts.
 */
export async function askDateValue(
  options: AskDateOptions,
): Promise<null | string> {
  const { allowEmpty = false, label, submitLabel, title, value = "" } = options;
  const locale = useSettingsStore.getState().locale as Locale;

  const values = await showFieldDialog({
    fields: [
      {
        key: "date",
        label,
        placeholder: "2026-08-30",
        type: "date",
        value,
      },
    ],
    submitLabel,
    title,
  });
  if (values === null) return null;

  const raw = (values.date ?? "").trim();
  if (raw === "") return allowEmpty ? "" : null;

  const iso = resolveDateInput(raw, new Date());
  if (iso === null) {
    useUIStore
      .getState()
      .showToast(t("tasks.triage.badDate", locale, { value: raw }), "error");
    return null;
  }
  return iso;
}
