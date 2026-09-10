// §80~§90/§342 Zettelkasten settings tab, promoted out of GeneralTab.
import { open } from "@tauri-apps/plugin-dialog";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../ipc/approval";
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
                const rel = dir && relativeToRoot(selected, dir);
                setZettelkastenHomeNote(rel || selected);

                // ‼️ (Fix E / I-9) 이전엔 여기서 `readFile`로 픽 시점 읽기를 시도했다.
                // 그런데 `check_vault`(Rust)가 보는 건 **등록된 컨텍스트 전체**이고,
                // 시작 시퀀스(zettelkasten-space.ts)는 제텔 디렉터리를 컨텍스트로
                // 등록한 **뒤에** 홈 노트를 읽는다 — 그래서 제텔 디렉터리 밖의 별도
                // 폴더를 쓰는 정상 설정에서도 픽 시점엔 항상 실패하고 시작 시엔
                // 항상 성공했다: 유효한 파일에 거짓 경고가 떴다. 게다가 옛 토스트는
                // "설정 › 볼트에서 승인하라"고 했는데, 그 경계가 보는 건 승인
                // 저장소가 아니라 컨텍스트 등록이므로 조언의 메커니즘도 틀렸다.
                //
                // 우리가 확실히 아는 건 하나뿐이다: 제텔 디렉터리 **안**의 파일은
                // 시작 시 그 디렉터리 자체가 등록되므로 반드시 읽힌다. 밖이면 그때
                // 가서 다른 어떤 컨텍스트가 등록돼 있는지에 달렸으므로 불확실하다.
                // 그래서 IPC 왕복 대신 이미 계산한 `rel`(위치)로만 판정한다 — 값은
                // 그대로 저장하고(상대/절대 모두 `resolveHomeNotePath`가 받는다),
                // 경고 문구도 우리가 아는 것만("시작 시 안 열릴 수 있다") 말한다.
                if (!rel) {
                  useUIStore
                    .getState()
                    .showToast(
                      t(
                        "settings.general.zettelkastenHomeNote.outsideZettelDir",
                      ),
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
