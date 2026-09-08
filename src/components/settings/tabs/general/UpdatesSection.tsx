// App-update settings section, split out of GeneralTab.
import { useEffect, useState } from "react";

import { getVersion } from "@tauri-apps/api/app";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import { checkForAppUpdate } from "../../../../services/app-update";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useAppUpdateStore } from "../../../../stores/system/app-update";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../../settings-shared";

export function UpdatesSection() {
  const { t } = useTranslation();
  const { autoCheckUpdates, setAutoCheckUpdates } = useSettingsStore(
    useShallow((s) => ({
      autoCheckUpdates: s.autoCheckUpdates,
      setAutoCheckUpdates: s.setAutoCheckUpdates,
    })),
  );
  const { updateStatus, updateAvailableVersion, openUpdateDialog } =
    useAppUpdateStore(
      useShallow((s) => ({
        updateStatus: s.status,
        updateAvailableVersion: s.availableVersion,
        openUpdateDialog: s.openDialog,
      })),
    );
  const [appVersion, setAppVersion] = useState("");

  // §206 ONE button, not two. A background check (15s after launch, then daily)
  // only raises a toast, so Settings still has to show that an update is
  // waiting — but a second button beside "Check Now" duplicated what the first
  // one already does when an update exists, and it appeared before the user had
  // pressed anything, which reads as a bug rather than as state. The single
  // button carries the state in its label and does what that label says.
  const updateReady =
    updateStatus === "available" && updateAvailableVersion !== null;

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
    <>
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
              if (updateReady) {
                openUpdateDialog();
                return;
              }
              checkForAppUpdate(true).catch(() => {
                /* errors are surfaced via the store's error status */
              });
            }}
          >
            {updateStatus === "checking"
              ? t("settings.general.updates.checking")
              : updateReady
                ? t("settings.general.updates.available").replace(
                    "{version}",
                    updateAvailableVersion,
                  )
                : t("settings.general.updates.checkNow")}
          </button>
        </div>
      </SettingsRow>
    </>
  );
}
