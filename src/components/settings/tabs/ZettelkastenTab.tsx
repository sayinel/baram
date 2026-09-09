// §80~§90/§342 Zettelkasten settings tab, promoted out of GeneralTab.
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../ipc/approval";
import { useSettingsStore } from "../../../stores/settings/store";
import { resolveAbsoluteDirSetting } from "../../../utils/path-utils";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";
import { TemplatePathRow } from "./general/TemplatePathRow";

export function ZettelkastenTab() {
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
    <div className="settings-section">
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
                // ‼️ Through the resolver, not raw. Both settings are documented absolute-only and the
                // row is readOnly, so a relative value only survives as legacy persisted
                // state — and zettelkastenDirectory has no scrub migration at all. Rust
                // would then stat it against the APP PROCESS CWD (src-tauri/ in dev, / for
                // a launched .app) and open the picker somewhere arbitrary (#556 review L2).
                const selected = await pickApprovedDir(
                  "zettelkasten",
                  resolveAbsoluteDirSetting(zettelkastenDirectory) ?? "",
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
                  e.target.value as "nothing" | "openHomeNote",
                )
              }
              value={zettelkastenStartupBehavior}
            >
              <option value="openHomeNote">
                {t("settings.general.zettelkastenStartup.openHomeNote")}
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
    </div>
  );
}
