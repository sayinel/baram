// §80~§90/§342 Zettelkasten settings tab, promoted out of GeneralTab.
import { open } from "@tauri-apps/plugin-dialog";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../ipc/approval";
import { readFile } from "../../../ipc/invoke";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import {
  relativeToRoot,
  resolveAbsoluteDirSetting,
} from "../../../utils/path-utils";
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
            <TemplatePathRow
              label={t("settings.general.zettelkastenHomeNote")}
              onBrowse={async () => {
                const dir = resolveAbsoluteDirSetting(zettelkastenDirectory);
                const selected = await open({
                  defaultPath: dir ?? undefined,
                  filters: [{ name: "Markdown", extensions: ["md"] }],
                });
                if (typeof selected !== "string") return;

                // §344 제텔 디렉터리 안이면 상대 경로로 저장한다 —
                // `resolveHomeNotePath` 가 상대/절대 두 갈래를 갖고 있고, 상대로 두면
                // 디렉터리를 옮겨도 설정이 산다.
                const rel = (dir && relativeToRoot(selected, dir)) || selected;
                setZettelkastenHomeNote(rel);

                // ‼️ 선택 시점에 읽을 수 있는지 확인한다. 제텔 디렉터리 밖이면 vault
                // 승인 경계(§329~)에 막혀 시작 시 조용히 실패하고, 사용자는 이유를
                // 알 수 없다. 시작마다 토스트를 띄우는 것은 소음이므로 여기서 말한다.
                try {
                  await readFile(selected);
                } catch {
                  useUIStore
                    .getState()
                    .showToast(
                      t("settings.general.zettelkastenHomeNote.unreadable"),
                      "warning",
                    );
                }
              }}
              onClear={() => setZettelkastenHomeNote("")}
              placeholder={t(
                "settings.general.zettelkastenHomeNote.placeholder",
              )}
              value={zettelkastenHomeNote}
            />
          </SettingsRow>
        </>
      )}
    </div>
  );
}
