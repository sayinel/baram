// §313 전역 캡처 단축키 설정 행 — 조합을 녹음하고, OS가 답한 결과를 그 자리에서 말한다.
//
// 값과 상태를 **따로** 보여 준다. 사용자가 적어 둔 조합은 그대로 남고, 그 밑줄이 지금
// 등록되어 있는지를 말한다 — 등록에 실패했다고 값을 지워 버리면 화면은 "설정하지 않음"이
// 되고, §313이 금지한 "조용히 무시"와 사용자 눈에는 구별되지 않는다.

import { useEffect, useState } from "react";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../../i18n/useTranslation";
import {
  formatKeyForDisplay,
  normalizeKeyEvent,
} from "../../../../keybindings/key-utils";
import { useSettingsStore } from "../../../../stores/settings/store";
import { useCaptureShortcutStatus } from "../../../../stores/tasks/capture-shortcut-status";
import { toAccelerator } from "../../../../utils/tasks/capture-shortcut";
import { SettingsRow } from "../../settings-shared";

/** 상태 종류 → 문구. 등록됨만 중립색이고 나머지 둘은 경고색이다. */
const STATUS_KEY = {
  idle: null,
  invalid: "settings.general.tasksGlobalCapture.invalid",
  registered: "settings.general.tasksGlobalCapture.registered",
  unavailable: "settings.general.tasksGlobalCapture.unavailable",
} as const;

export function GlobalCaptureRow() {
  const { t } = useTranslation();
  const { setTasksGlobalCaptureShortcut, shortcut } = useSettingsStore(
    useShallow((s) => ({
      setTasksGlobalCaptureShortcut: s.setTasksGlobalCaptureShortcut,
      shortcut: s.tasksGlobalCaptureShortcut,
    })),
  );
  const status = useCaptureShortcutStatus((s) => s.status);
  const [capturing, setCapturing] = useState(false);
  const isMac = navigator.platform.includes("Mac");

  useEffect(() => {
    if (!capturing) return;

    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;
      // ‼️ 여기서 곧바로 확정한다(키빈딩 탭의 확인 단계가 없다). 전역 조합은 등록해 봐야
      // 쓸 수 있는지 알 수 있으므로, 확인 단계를 두면 사용자는 "확인"을 누른 다음에야
      // 안 된다는 말을 듣는다. 대신 아래 상태줄이 결과를 즉시 말한다.
      setTasksGlobalCaptureShortcut(normalized);
      setCapturing(false);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, isMac, setTasksGlobalCaptureShortcut]);

  const statusKey = STATUS_KEY[status.kind];
  const warn = status.kind === "invalid" || status.kind === "unavailable";

  return (
    <SettingsRow
      description={t("settings.general.tasksGlobalCapture.desc")}
      label={t("settings.general.tasksGlobalCapture")}
    >
      <div className="global-capture-control">
        <div className="settings-key-row">
          <kbd className="keybinding-kbd global-capture-kbd">
            {capturing
              ? t("settings.general.tasksGlobalCapture.capturing")
              : shortcut
                ? formatKeyForDisplay(shortcut, isMac)
                : t("settings.general.tasksGlobalCapture.none")}
          </kbd>
          <button
            className="settings-key-toggle"
            onClick={() => setCapturing((v) => !v)}
          >
            {capturing
              ? t("common.cancel")
              : t("settings.general.tasksGlobalCapture.record")}
          </button>
          <button
            className="settings-key-toggle"
            disabled={!shortcut}
            onClick={() => setTasksGlobalCaptureShortcut(null)}
          >
            {t("settings.general.tasksGlobalCapture.clear")}
          </button>
        </div>
        {statusKey && (
          <p
            className={`global-capture-status${warn ? "is-warn" : ""}`}
            role={warn ? "alert" : undefined}
          >
            {t(statusKey).replace(
              "{value}",
              status.kind === "registered"
                ? status.accelerator
                : (toAccelerator(shortcut) ?? ""),
            )}
          </p>
        )}
      </div>
    </SettingsRow>
  );
}
