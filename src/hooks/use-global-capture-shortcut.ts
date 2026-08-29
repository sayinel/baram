// §313 전역 캡처 단축키의 수명주기 — 설정 값 하나에 OS 등록 하나를 맞춰 둔다.
//
// 등록을 Rust가 아니라 여기서 하는 이유는 §313의 필수 요건 때문이다: 조합이 이미 다른
// 앱에 점유되어 있으면 등록은 실패하는데, **그 실패가 조용하면 사용자는 원인을 알 수
// 없다.** 실패를 말할 수 있는 곳은 설정 화면이고, 설정 화면이 읽을 수 있는 곳은 여기다.

import { useEffect } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";

import { useSettingsStore } from "../stores/settings/store";
import { setCaptureShortcutStatus } from "../stores/tasks/capture-shortcut-status";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";
import { toAccelerator } from "../utils/tasks/capture-shortcut";

/**
 * 설정된 조합 하나를 OS에 등록해 두고, 값이 바뀌면 이전 것을 반드시 해제한다.
 *
 * 앱 전체에서 **한 번만** 마운트한다(App.tsx). 두 번 마운트되면 같은 조합을 두 번
 * 등록하려다 두 번째가 실패하고, 실패 상태가 화면에 남는다.
 */
export function useGlobalCaptureShortcut(): void {
  const shortcut = useSettingsStore((s) => s.tasksGlobalCaptureShortcut);

  useEffect(() => {
    const accelerator = toAccelerator(shortcut);

    if (!shortcut) {
      setCaptureShortcutStatus({ kind: "idle" });
      return;
    }
    if (!accelerator) {
      // 번역기가 거절한 조합 — 수식키가 없다. OS에 물어볼 것도 없이 여기서 끝난다.
      setCaptureShortcutStatus({ kind: "invalid" });
      return;
    }

    let cancelled = false;
    // 해제는 등록에 **성공했을 때만** 한다. 실패한 조합을 unregister하면 그 조합을
    // 실제로 쥐고 있는 다른 앱의 등록을 우리가 풀어 버릴 수 있다.
    let registered = false;

    void (async () => {
      try {
        await register(accelerator, (event) => {
          // 누를 때와 뗄 때 두 번 온다 — 뗄 때 무시하지 않으면 창이 열리고 바로 한 번 더
          // 열린다(두 번째 열기가 본문을 지운다).
          if (event.state !== "Pressed") return;
          void bringUpCapture();
        });
        if (cancelled) {
          // 값이 또 바뀐 뒤에 등록이 끝난 경우. 등록해 둔 채로 두면 유령이 남는다.
          void unregisterQuietly(accelerator);
          return;
        }
        registered = true;
        setCaptureShortcutStatus({ accelerator, kind: "registered" });
      } catch (err) {
        if (cancelled) return;
        // ‼️ 여기서 조용히 지나가면 §313이 금지한 상태가 된다 — 사용자는 설정에 조합을
        // 적어 두고 눌러도 아무 일이 없는 이유를 알 수 없다.
        logger.error("§313 global capture shortcut registration failed", err);
        setCaptureShortcutStatus({ kind: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
      if (registered) void unregisterQuietly(accelerator);
    };
  }, [shortcut]);
}

/** 앱을 앞으로 불러내고 캡처창을 태스크 모드로 연다. */
async function bringUpCapture(): Promise<void> {
  useUIStore.getState().openQuickCaptureForTask();
  try {
    const win = getCurrentWindow();
    // 순서가 있다: 최소화된 창은 show()만으로는 올라오지 않고, 보이지 않는 창은
    // setFocus()가 듣지 않는다.
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch (err) {
    // 창을 못 불러왔어도 캡처창 상태는 이미 열림이다 — 앱으로 돌아오면 거기 있다.
    logger.error("§313 could not bring the window forward", err);
  }
}

/** 해제 실패는 사용자에게 보여 줄 것이 없다 — 로그로만 남긴다. */
async function unregisterQuietly(accelerator: string): Promise<void> {
  try {
    await unregister(accelerator);
  } catch (err) {
    logger.error("§313 global capture shortcut unregister failed", err);
  }
}
