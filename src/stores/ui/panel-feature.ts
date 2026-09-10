// §340 사이드바/우측 패널 좌석이 속한 기능 — 렌더 시점 게이트가 읽는 단일 표.
//
// `use-settings-effects.ts`(ⓐ 포인터 이동 이펙트)와 `AppLayout`(ⓒ 렌더 필터, C-2/I-1/I-2)이
// 둘 다 이 표를 읽는다. `AppLayout`은 뜨거운 모듈이라 에디터·메뉴 IPC를 끌고 오는
// `use-settings-effects.ts` 를 import 할 수 없으므로, 두 표는 **import가 없는** 별도 모듈에
// 산다 — `feature-keys.ts` 가 `store.ts` ↔ `activity-bar-config.ts` 순환을 끊기 위해 import
// 0개인 것과 같은 이유다. (타입 import는 컴파일 시 지워지므로 값 간선을 만들지 않는다.)
import type { FeatureKey } from "../settings/feature-keys";
import type { RightPanelMode, SidebarPanel } from "./ui";

/**
 * §340 사이드바 좌석 → 그 좌석을 소유한 기능.
 *
 * export된 이유: `feature-seat-pointer.test.tsx`가 이 표와 아래 표를 **순회**해서 ⓐ
 * 이펙트를 검증한다 — 항목을 하나하나 베껴 적으면 다음에 좌석이 추가돼도 테스트가
 * 조용히 그 항목을 놓친다(파생 검증이 이 표의 존재 이유).
 */
export const SIDEBAR_PANEL_FEATURE: Partial<Record<SidebarPanel, FeatureKey>> =
  {
    calendar: "journal",
    tasks: "tasks",
    zettel: "zettelkasten",
  };

/** §340 우측 패널 좌석 → 그 좌석을 소유한 기능. (export 이유는 위와 동일) */
export const RIGHT_PANEL_MODE_FEATURE: Partial<
  Record<RightPanelMode, FeatureKey>
> = {
  chat: "ai",
  memories: "journal",
  "photo-gallery": "journal",
};

/**
 * §340 ⓒ `rightPanelMode`가 가리키는 기능이 꺼져 있으면 우측 패널을 렌더하지 않는다 —
 * ⓐ(이동 이펙트)가 발화했는지와 무관하게. `AppLayout`은 이 술어로 `.app-right-panel`
 * 청크 전체(aside + Splitter)를 건다.
 *
 * 안쪽 네 패널(AIChatPanel 등)이 각자 자기 모드를 확인해 null을 돌려주는 것(ⓑ)과는
 * 별개 층이다 — 넷 다 null을 돌려줘도 그 바깥 aside/Splitter는 그것과 무관하게 열려
 * 있었던 것이 이 결함의 정확한 모양이었다("빈 패널이 열린 채, 닫을 아이콘 없음").
 *
 * `mode === "none"`을 별도로 배제하는 이유: `RIGHT_PANEL_MODE_FEATURE`에 "none" 항목이
 * 없어 `feature`가 `undefined`가 되고, 그러면 기능 검사만으로는 늘 통과한다 — ⓐ가 옮겨
 * 놓은 값이 바로 "none"(패널은 열린 채)이므로, 이 케이스를 놓치면 C-2가 다시 열린다.
 */
export function isRightPanelUsable(
  mode: RightPanelMode,
  flags: Record<FeatureKey, boolean>,
): boolean {
  if (mode === "none") return false;
  const feature = RIGHT_PANEL_MODE_FEATURE[mode];
  return feature === undefined || flags[feature];
}
