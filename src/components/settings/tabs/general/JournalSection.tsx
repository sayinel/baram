// §85 Journal settings section, split out of GeneralTab.
import { useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { MigrationDirection } from "../../../journal/MigrationDialog";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../../ipc/approval";
import { useSettingsStore } from "../../../../stores/settings/store";
import { initJournalTemplatesDir } from "../../../../utils/journal/journal-templates";
import { MigrationDialog } from "../../../journal/MigrationDialog";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../../settings-shared";
import { TemplatePathRow } from "./TemplatePathRow";

export function JournalSection() {
  const { t } = useTranslation();
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationDirection, setMigrationDirection] =
    useState<MigrationDirection>("toHierarchy");
  const [templatesInitMsg, setTemplatesInitMsg] = useState<null | string>(null);
  const {
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
  } = useSettingsStore(
    useShallow((s) => ({
      journalEnabled: s.journalEnabled,
      setJournalEnabled: s.setJournalEnabled,
      journalDirectory: s.journalDirectory,
      setJournalDirectory: s.setJournalDirectory,
      journalFilenameFormat: s.journalFilenameFormat,
      setJournalFilenameFormat: s.setJournalFilenameFormat,
      journalTemplatePath: s.journalTemplatePath,
      setJournalTemplatePath: s.setJournalTemplatePath,
      journalStartupBehavior: s.journalStartupBehavior,
      setJournalStartupBehavior: s.setJournalStartupBehavior,
      journalUseHierarchy: s.journalUseHierarchy,
      setJournalUseHierarchy: s.setJournalUseHierarchy,
      journalWeeklyTemplate: s.journalWeeklyTemplate,
      setJournalWeeklyTemplate: s.setJournalWeeklyTemplate,
      journalMonthlyTemplate: s.journalMonthlyTemplate,
      setJournalMonthlyTemplate: s.setJournalMonthlyTemplate,
      journalYearlyTemplate: s.journalYearlyTemplate,
      setJournalYearlyTemplate: s.setJournalYearlyTemplate,
    })),
  );

  return (
    <>
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
            <TemplatePathRow
              onBrowse={async () => {
                const selected = await pickApprovedDir("journal");
                if (selected) setJournalDirectory(selected);
              }}
              placeholder={t("settings.general.journalDirectory.placeholder")}
              value={journalDirectory}
            />
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
            <TemplatePathRow
              onBrowse={async () => {
                const selected = await open({
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (selected) setJournalTemplatePath(selected);
              }}
              onClear={() => setJournalTemplatePath("")}
              placeholder={t("settings.general.journalTemplate.placeholder")}
              value={journalTemplatePath}
            />
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
            <TemplatePathRow
              onBrowse={async () => {
                const selected = await open({
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (selected) setJournalWeeklyTemplate(selected);
              }}
              onClear={() => setJournalWeeklyTemplate("")}
              placeholder={t("settings.general.journalTemplate.placeholder")}
              value={journalWeeklyTemplate}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.monthlyTemplate.desc")}
            label={t("settings.general.monthlyTemplate")}
          >
            <TemplatePathRow
              onBrowse={async () => {
                const selected = await open({
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (selected) setJournalMonthlyTemplate(selected);
              }}
              onClear={() => setJournalMonthlyTemplate("")}
              placeholder={t("settings.general.journalTemplate.placeholder")}
              value={journalMonthlyTemplate}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.yearlyTemplate.desc")}
            label={t("settings.general.yearlyTemplate")}
          >
            <TemplatePathRow
              onBrowse={async () => {
                const selected = await open({
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (selected) setJournalYearlyTemplate(selected);
              }}
              onClear={() => setJournalYearlyTemplate("")}
              placeholder={t("settings.general.journalTemplate.placeholder")}
              value={journalYearlyTemplate}
            />
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

      <MigrationDialog
        direction={migrationDirection}
        journalDir={journalDirectory}
        onClose={() => setMigrationOpen(false)}
        open={migrationOpen}
      />
    </>
  );
}
