import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";
import { JournalSection } from "./general/JournalSection";
import { TasksSection } from "./general/TasksSection";
import { UpdatesSection } from "./general/UpdatesSection";
import { ZettelkastenSection } from "./general/ZettelkastenSection";

export function GeneralTab() {
  const { t } = useTranslation();
  const {
    onLaunch,
    setOnLaunch,
    autoSave,
    setAutoSave,
    autoSaveDelay,
    setAutoSaveDelay,
    spellCheck,
    setSpellCheck,
    wikilinkFormat,
    setWikilinkFormat,
    autoUpdateLinks,
    setAutoUpdateLinks,
    snapshotInterval,
    setSnapshotInterval,
    snapshotMaxCount,
    setSnapshotMaxCount,
  } = useSettingsStore(
    useShallow((s) => ({
      onLaunch: s.onLaunch,
      setOnLaunch: s.setOnLaunch,
      autoSave: s.autoSave,
      setAutoSave: s.setAutoSave,
      autoSaveDelay: s.autoSaveDelay,
      setAutoSaveDelay: s.setAutoSaveDelay,
      spellCheck: s.spellCheck,
      setSpellCheck: s.setSpellCheck,
      wikilinkFormat: s.wikilinkFormat,
      setWikilinkFormat: s.setWikilinkFormat,
      autoUpdateLinks: s.autoUpdateLinks,
      setAutoUpdateLinks: s.setAutoUpdateLinks,
      snapshotInterval: s.snapshotInterval,
      setSnapshotInterval: s.setSnapshotInterval,
      snapshotMaxCount: s.snapshotMaxCount,
      setSnapshotMaxCount: s.setSnapshotMaxCount,
    })),
  );

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.general.startup")} />

      <SettingsRow
        description={t("settings.general.onLaunch.desc")}
        label={t("settings.general.onLaunch")}
      >
        <select
          className="settings-select"
          onChange={(e) =>
            setOnLaunch(
              e.target.value as
                "newFile" | "restoreLastFile" | "restoreLastFolder",
            )
          }
          value={onLaunch}
        >
          <option value="restoreLastFolder">
            {t("settings.general.onLaunch.restoreLastFolder")}
          </option>
          <option value="restoreLastFile">
            {t("settings.general.onLaunch.restoreLastFile")}
          </option>
          <option value="newFile">
            {t("settings.general.onLaunch.newFile")}
          </option>
        </select>
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.saving")} />

      <SettingsRow
        description={t("settings.general.autoSave.desc")}
        label={t("settings.general.autoSave")}
      >
        <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
      </SettingsRow>

      {autoSave && (
        <SettingsRow
          description={t("settings.general.saveDelay.desc").replace(
            "{value}",
            (autoSaveDelay / 1000).toFixed(1),
          )}
          label={t("settings.general.saveDelay")}
        >
          <input
            className="settings-range"
            max={10000}
            min={500}
            onChange={(e) => setAutoSaveDelay(Number(e.target.value))}
            step={500}
            type="range"
            value={autoSaveDelay}
          />
        </SettingsRow>
      )}

      <SettingsSectionHeader title={t("settings.general.system")} />

      <SettingsRow
        description={t("settings.general.spellCheck.desc")}
        label={t("settings.general.spellCheck")}
      >
        <ToggleSwitch checked={spellCheck} onChange={setSpellCheck} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.links")} />

      <SettingsRow
        description={t("settings.general.linkFormat.desc")}
        label={t("settings.general.linkFormat")}
      >
        <select
          className="settings-select"
          onChange={(e) =>
            setWikilinkFormat(e.target.value as "markdown" | "wikilink")
          }
          value={wikilinkFormat}
        >
          <option value="wikilink">[[Wikilink]]</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      </SettingsRow>

      <SettingsRow
        description={t("settings.general.autoUpdateLinks.desc")}
        label={t("settings.general.autoUpdateLinks")}
      >
        <ToggleSwitch checked={autoUpdateLinks} onChange={setAutoUpdateLinks} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.snapshots")} />

      <SettingsRow
        description={t("settings.general.snapshotInterval.desc").replace(
          "{value}",
          String(snapshotInterval),
        )}
        label={t("settings.general.snapshotInterval")}
      >
        <input
          className="settings-range"
          max={120}
          min={0}
          onChange={(e) => setSnapshotInterval(Number(e.target.value))}
          step={5}
          type="range"
          value={snapshotInterval}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.general.snapshotMaxCount.desc").replace(
          "{value}",
          String(snapshotMaxCount),
        )}
        label={t("settings.general.snapshotMaxCount")}
      >
        <input
          className="settings-range"
          max={200}
          min={5}
          onChange={(e) => setSnapshotMaxCount(Number(e.target.value))}
          step={5}
          type="range"
          value={snapshotMaxCount}
        />
      </SettingsRow>

      <JournalSection />
      <TasksSection />
      <ZettelkastenSection />
      <UpdatesSection />
    </div>
  );
}
