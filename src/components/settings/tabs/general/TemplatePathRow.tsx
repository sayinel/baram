// §86 Settings — shared browse/clear file-or-directory picker row.
// Extracted from GeneralTab: the same input+"Browse"(+"Clear") shell was
// repeated for journalDirectory/journalTemplatePath/journalWeeklyTemplate/
// journalMonthlyTemplate/journalYearlyTemplate. Each caller still owns its
// own IPC dialog call and setter — this only shares the DOM shell.
import { useEffect, useRef } from "react";

import { useTranslation } from "../../../../i18n/useTranslation";
import { Tooltip } from "../../../Tooltip";

export function TemplatePathRow({
  label,
  placeholder,
  value,
  onBrowse,
  onClear,
}: {
  /** The row's visible label. Names the field for assistive tech, which the sibling
   *  <span> in SettingsRow cannot do. */
  label: string;
  onBrowse: () => void;
  onClear?: () => void;
  placeholder: string;
  value: string;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // An input shows a too-long value from its START, and the start of a path is the part every
  // path here has in common. The question being asked of this field is "which folder?", and
  // that answer is the last component — so the field is parked at its end.
  //
  // Safe to do unconditionally only because this input is readOnly: on an editable one this
  // would fight the caret on every keystroke.
  useEffect(() => {
    const el = inputRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [value]);

  return (
    <div className="settings-key-row settings-key-row--path">
      {/* Placed above rather than beside: this row already sits at the right edge of the
          settings modal, and a path is the widest label the tooltip has to carry. */}
      <Tooltip label={value} placement="top">
        <input
          aria-label={label}
          className="settings-input settings-input-key"
          placeholder={placeholder}
          readOnly
          ref={inputRef}
          type="text"
          value={value}
        />
      </Tooltip>
      <button className="settings-key-toggle" onClick={onBrowse}>
        {t("common.browse")}
      </button>
      {onClear && value && (
        <button className="settings-key-toggle" onClick={onClear}>
          {t("common.clear")}
        </button>
      )}
    </div>
  );
}
