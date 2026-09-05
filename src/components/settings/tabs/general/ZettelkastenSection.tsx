// §80~§90 Zettelkasten settings section, split out of GeneralTab.
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../../ipc/approval";
import { useSettingsStore } from "../../../../stores/settings/store";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../../settings-shared";
import { TemplatePathRow } from "./TemplatePathRow";

export function ZettelkastenSection() {
  const { t } = useTranslation();
  const {
    zettelkastenEnabled,
    setZettelkastenEnabled,
    zettelkastenDirectory,
    setZettelkastenDirectory,
    zettelkastenStartupBehavior,
    setZettelkastenStartupBehavior,
    zettelkastenHomeNote,
    setZettelkastenHomeNote,
  } = useSettingsStore(
    useShallow((s) => ({
      zettelkastenEnabled: s.zettelkastenEnabled,
      setZettelkastenEnabled: s.setZettelkastenEnabled,
      zettelkastenDirectory: s.zettelkastenDirectory,
      setZettelkastenDirectory: s.setZettelkastenDirectory,
      zettelkastenStartupBehavior: s.zettelkastenStartupBehavior,
      setZettelkastenStartupBehavior: s.setZettelkastenStartupBehavior,
      zettelkastenHomeNote: s.zettelkastenHomeNote,
      setZettelkastenHomeNote: s.setZettelkastenHomeNote,
    })),
  );

  return (
    <>
      <SettingsSectionHeader title={t("settings.general.zettelkasten")} />

      <SettingsRow
        description={t("settings.general.zettelkastenEnabled.desc")}
        label={t("settings.general.zettelkastenEnabled")}
      >
        <ToggleSwitch
          checked={zettelkastenEnabled}
          onChange={setZettelkastenEnabled}
        />
      </SettingsRow>

      {zettelkastenEnabled && (
        <>
          <SettingsRow
            description={t("settings.general.zettelkastenDirectory.desc")}
            label={t("settings.general.zettelkastenDirectory")}
          >
            <TemplatePathRow
              label={t("settings.general.zettelkastenDirectory")}
              onBrowse={async () => {
                const selected = await pickApprovedDir(
                  "zettelkasten",
                  zettelkastenDirectory,
                );
                if (selected) setZettelkastenDirectory(selected);
              }}
              placeholder={t(
                "settings.general.zettelkastenDirectory.placeholder",
              )}
              value={zettelkastenDirectory}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.zettelkastenStartup.desc")}
            label={t("settings.general.zettelkastenStartup")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setZettelkastenStartupBehavior(
                  e.target.value as "nothing" | "openInbox",
                )
              }
              value={zettelkastenStartupBehavior}
            >
              <option value="openInbox">
                {t("settings.general.zettelkastenStartup.openInbox")}
              </option>
              <option value="nothing">
                {t("settings.general.zettelkastenStartup.nothing")}
              </option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.zettelkastenHomeNote.desc")}
            label={t("settings.general.zettelkastenHomeNote")}
          >
            <input
              className="settings-input"
              onChange={(e) => setZettelkastenHomeNote(e.target.value)}
              placeholder={t(
                "settings.general.zettelkastenHomeNote.placeholder",
              )}
              type="text"
              value={zettelkastenHomeNote}
            />
          </SettingsRow>
        </>
      )}
    </>
  );
}
