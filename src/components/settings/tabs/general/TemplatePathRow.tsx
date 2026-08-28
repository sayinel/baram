// §86 Settings — shared browse/clear file-or-directory picker row.
// Extracted from GeneralTab: the same input+"Browse"(+"Clear") shell was
// repeated for journalDirectory/journalTemplatePath/journalWeeklyTemplate/
// journalMonthlyTemplate/journalYearlyTemplate. Each caller still owns its
// own IPC dialog call and setter — this only shares the DOM shell.
import { useTranslation } from "../../../../i18n/useTranslation";

export function TemplatePathRow({
  placeholder,
  value,
  onBrowse,
  onClear,
}: {
  onBrowse: () => void;
  onClear?: () => void;
  placeholder: string;
  value: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="settings-key-row">
      <input
        className="settings-input settings-input-key"
        placeholder={placeholder}
        readOnly
        type="text"
        value={value}
      />
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
