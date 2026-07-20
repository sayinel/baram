import { useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";

import type { MigrationDirection } from "../../journal/MigrationDialog";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { checkForAppUpdate } from "../../../services/app-update";
import { useSettingsStore } from "../../../stores/settings/store";
import { useAppUpdateStore } from "../../../stores/system/app-update";
import { initJournalTemplatesDir } from "../../../utils/journal/journal-templates";
import { MigrationDialog } from "../../journal/MigrationDialog";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";

export function GeneralTab() {
  const { t } = useTranslation();
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationDirection, setMigrationDirection] =
    useState<MigrationDirection>("toHierarchy");
  const [templatesInitMsg, setTemplatesInitMsg] = useState<null | string>(null);
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
    journalEnabled,
    setJournalEnabled,
    journalDirectory,
    setJournalDirectory,
    journalFilenameFormat,
    setJournalFilenameFormat,
    journalTemplatePath,
    setJournalTemplatePath,
    journalStartupBehavior,
    setJournalStartupBehavior,
    journalUseHierarchy,
    setJournalUseHierarchy,
    journalWeeklyTemplate,
    setJournalWeeklyTemplate,
    journalMonthlyTemplate,
    setJournalMonthlyTemplate,
    journalYearlyTemplate,
    setJournalYearlyTemplate,
    zettelkastenEnabled,
    setZettelkastenEnabled,
    zettelkastenDirectory,
    setZettelkastenDirectory,
    zettelkastenStartupBehavior,
    setZettelkastenStartupBehavior,
    zettelkastenHomeNote,
    setZettelkastenHomeNote,
    autoCheckUpdates,
    setAutoCheckUpdates,
  } = useSettingsStore();
  const { updateStatus, updateAvailableVersion, openUpdateDialog } =
    useAppUpdateStore(
      useShallow((s) => ({
        updateStatus: s.status,
        updateAvailableVersion: s.availableVersion,
        openUpdateDialog: s.openDialog,
      })),
    );
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        /* non-Tauri context (e.g. tests) — leave version blank */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      <SettingsSectionHeader title={t("settings.general.journal")} />

      <SettingsRow
        description={t("settings.general.journalEnabled.desc")}
        label={t("settings.general.journalEnabled")}
      >
        <ToggleSwitch checked={journalEnabled} onChange={setJournalEnabled} />
      </SettingsRow>

      {journalEnabled && (
        <>
          <SettingsRow
            description={t("settings.general.journalDirectory.desc")}
            label={t("settings.general.journalDirectory")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalDirectory.placeholder")}
                readOnly
                type="text"
                value={journalDirectory}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (selected) setJournalDirectory(selected);
                }}
              >
                {t("common.browse")}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalFilenameFormat.desc")}
            label={t("settings.general.journalFilenameFormat")}
          >
            <select
              className="settings-select"
              onChange={(e) => setJournalFilenameFormat(e.target.value)}
              value={journalFilenameFormat}
            >
              <option value="YYYY-MM-DD.md">YYYY-MM-DD.md</option>
              <option value="YYYYMMDD.md">YYYYMMDD.md</option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalTemplate.desc")}
            label={t("settings.general.journalTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalTemplatePath}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalTemplatePath(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalTemplatePath && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalTemplatePath("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalStartup.desc")}
            label={t("settings.general.journalStartup")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setJournalStartupBehavior(
                  e.target.value as "nothing" | "openJournal",
                )
              }
              value={journalStartupBehavior}
            >
              <option value="openJournal">
                {t("settings.general.journalStartup.openJournal")}
              </option>
              <option value="nothing">
                {t("settings.general.journalStartup.nothing")}
              </option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalHierarchy.desc")}
            label={t("settings.general.journalHierarchy")}
          >
            <ToggleSwitch
              checked={journalUseHierarchy}
              onChange={setJournalUseHierarchy}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              description={
                journalUseHierarchy
                  ? t("settings.general.journalMigrate.desc")
                  : t("settings.general.journalFlatten.desc")
              }
              label={
                journalUseHierarchy
                  ? t("settings.general.journalMigrate")
                  : t("settings.general.journalFlatten")
              }
            >
              <button
                className="settings-key-toggle"
                onClick={() => {
                  setMigrationDirection(
                    journalUseHierarchy ? "toHierarchy" : "toFlat",
                  );
                  setMigrationOpen(true);
                }}
              >
                {journalUseHierarchy
                  ? t("settings.general.journalMigrate.button")
                  : t("settings.general.journalFlatten.button")}
              </button>
            </SettingsRow>
          )}

          <SettingsSectionHeader
            title={t("settings.general.periodicTemplates")}
          />

          <SettingsRow
            description={t("settings.general.weeklyTemplate.desc")}
            label={t("settings.general.weeklyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalWeeklyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalWeeklyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalWeeklyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalWeeklyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.monthlyTemplate.desc")}
            label={t("settings.general.monthlyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalMonthlyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalMonthlyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalMonthlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalMonthlyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.yearlyTemplate.desc")}
            label={t("settings.general.yearlyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalYearlyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalYearlyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalYearlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalYearlyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              description={t("settings.general.createTemplateFiles.desc")}
              label={t("settings.general.createTemplateFiles")}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                <button
                  className="settings-key-toggle"
                  onClick={async () => {
                    try {
                      await initJournalTemplatesDir(journalDirectory);
                      setTemplatesInitMsg(
                        t("settings.general.createTemplateFiles.success"),
                      );
                    } catch {
                      setTemplatesInitMsg(
                        t("settings.general.createTemplateFiles.error"),
                      );
                    }
                    setTimeout(() => setTemplatesInitMsg(null), 3000);
                  }}
                >
                  {t("settings.general.createTemplateFiles.button")}
                </button>
                {templatesInitMsg && (
                  <span className="settings-row-description">
                    {templatesInitMsg}
                  </span>
                )}
              </div>
            </SettingsRow>
          )}
        </>
      )}

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
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t(
                  "settings.general.zettelkastenDirectory.placeholder",
                )}
                readOnly
                type="text"
                value={zettelkastenDirectory}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (typeof selected === "string")
                    setZettelkastenDirectory(selected);
                }}
              >
                {t("common.browse")}
              </button>
            </div>
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

      <SettingsSectionHeader title={t("settings.general.updates")} />

      <SettingsRow label={t("settings.general.updates.version")}>
        <span className="settings-row-description">v{appVersion}</span>
      </SettingsRow>

      <SettingsRow
        description={t("settings.general.updates.autoCheck.desc")}
        label={t("settings.general.updates.autoCheck")}
      >
        <ToggleSwitch
          checked={autoCheckUpdates}
          onChange={setAutoCheckUpdates}
        />
      </SettingsRow>

      <SettingsRow label={t("settings.general.updates.checkNow")}>
        <div className="settings-key-row">
          <button
            className="settings-key-toggle"
            disabled={updateStatus === "checking"}
            onClick={() => {
              checkForAppUpdate(true).catch(() => {
                /* errors are surfaced via the store's error status */
              });
            }}
          >
            {updateStatus === "checking"
              ? t("settings.general.updates.checking")
              : t("settings.general.updates.checkNow")}
          </button>
          {updateStatus === "available" && (
            <button className="settings-key-toggle" onClick={openUpdateDialog}>
              {t("settings.general.updates.available").replace(
                "{version}",
                updateAvailableVersion ?? "",
              )}
            </button>
          )}
        </div>
      </SettingsRow>

      <MigrationDialog
        direction={migrationDirection}
        journalDir={journalDirectory}
        onClose={() => setMigrationOpen(false)}
        open={migrationOpen}
      />
    </div>
  );
}
