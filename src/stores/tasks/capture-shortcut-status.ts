// §313 전역 캡처 단축키가 지금 실제로 어떤 상태인가 — 설정 화면이 읽는 곳.
//
// 설정 값(`tasksGlobalCaptureShortcut`)과 **분리해서** 둔다. 값은 사용자가 원하는 것이고
// 이것은 OS가 답한 것이다. 둘을 한 값에 담으면 등록에 실패했을 때 사용자가 적어 둔 조합을
// 지우게 되고, 화면은 "아무것도 설정하지 않음"이 된다 — 실패를 감추는 것과 같다.
//
// persist하지 않는다: 점유 여부는 그때그때 다른 앱 사정이라, 지난 세션의 답을 되살리면
// 지금 쓸 수 있는 조합을 못 쓴다고 말하게 된다.

import { create } from "zustand";

export type CaptureShortcutStatus =
  /** 설정된 값이 없다 */
  | { accelerator: string; kind: "registered" }
  /** 전역 단축키가 될 수 없는 조합 — 수식키가 없다 */
  | { kind: "idle" }
  /** OS가 등록을 거절했다 — 대개 다른 앱이 쥐고 있다 */
  | { kind: "invalid" }
  /** 등록됨 */
  | { kind: "unavailable" };

interface CaptureShortcutStatusStore {
  status: CaptureShortcutStatus;
}

export const useCaptureShortcutStatus = create<CaptureShortcutStatusStore>(
  () => ({ status: { kind: "idle" } }),
);

export function setCaptureShortcutStatus(status: CaptureShortcutStatus): void {
  // 같은 상태면 쓰지 않는다 — 등록 시도는 설정을 열어 둔 채 타이핑하는 동안에도
  // 일어나고, 매번 새 root를 만들면 설정 화면 전체가 다시 그려진다.
  const current = useCaptureShortcutStatus.getState().status;
  if (sameStatus(current, status)) return;
  useCaptureShortcutStatus.setState({ status });
}

function sameStatus(
  a: CaptureShortcutStatus,
  b: CaptureShortcutStatus,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "registered" && b.kind === "registered") {
    return a.accelerator === b.accelerator;
  }
  return true;
}
