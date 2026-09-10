// §340 ⓒ AppLayout's right-panel wrapper (Splitter + `.app-right-panel` aside) must not
// render when the feature owning the CURRENT `rightPanelMode` is disabled — regardless of
// whether ⓐ (the pointer-move effect in use-settings-effects.ts) has fired. See
// `fix-b-brief.md` (C-2 / I-1 / I-2): the four panels each already return null for a mode
// they don't own (ⓑ, feature-seat-pointer.test.tsx), but that left the OUTER aside/Splitter
// chrome up regardless — an empty panel with no icon left to close it, because this branch
// hid all three escape hatches (activity bar icon, chat shortcut, native menu) for a
// disabled feature.
//
// ‼️ `.app-right-panel` lives on the `<aside>` OUTSIDE AppLayout's `<Suspense
// fallback={null}>` boundary, so — unlike `Sidebar.tsx`'s `.sidebar-content` fallback,
// which shares a class with its content and makes a child-count assertion on it vacuous —
// there is no shared-class trap here: a synchronous presence/absence check on
// `.app-right-panel` is sound without `waitFor`.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { useFileStore } from "../../../stores/file/file";
import { ACTIVITY_BAR_ITEM_FEATURE } from "../../../stores/settings/activity-bar-config";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  isRightPanelUsable,
  RIGHT_PANEL_MODE_FEATURE,
  SIDEBAR_PANEL_FEATURE,
} from "../../../stores/ui/panel-feature";
import { useUIStore } from "../../../stores/ui/ui";
import { AppLayout } from "../AppLayout";

// ‼️ 소진 산술 (재리뷰 I-A). 두 좌석 맵의 `it.each` 는 **맵 자신을 순회**하므로 항목이
// 사라지면 케이스가 하나 줄 뿐 아무것도 실패하지 않는다 — 실측: `photo-gallery` 한 줄을
// 지우고 6파일 71건을 돌렸더니 전부 초록이었다. 그러면 `isRightPanelUsable` 이 맵에 없는
// 모드를 `feature === undefined` 로 통과시키고, 안쪽 패널이 ⓑ 로 null 을 돌려
// **빈 aside 가 닫을 수단 없이 열린다** — C-2 의 정확한 모양이다.
//
// 값 눈멀음은 `ACTIVITY_BAR_ITEM_FEATURE` 교차 검증으로 닫았지만 **키 누락은 그것도 못
// 본다**(없는 키는 순회에 안 들어온다). 그래서 개수가 아니라 **집합**을 단정한다: 여섯
// 좌석이 두 맵으로 정확히 분할되고, 그 합집합이 활동표시줄의 소유 표와 같다.
describe("the two seat maps partition the feature-owned seats (§340 I-A)", () => {
  it("covers exactly the activity bar's feature-owned items, with no overlap", () => {
    const sidebar = Object.keys(SIDEBAR_PANEL_FEATURE);
    const rightPanel = Object.keys(RIGHT_PANEL_MODE_FEATURE);

    expect([...sidebar, ...rightPanel].sort()).toEqual(
      Object.keys(ACTIVITY_BAR_ITEM_FEATURE).sort(),
    );
    // 분할이므로 교집합은 비어야 한다 — 한 좌석이 두 맵에 있으면 어느 쪽이 이기는지가
    // 호출 순서에 달린다.
    expect(sidebar.filter((k) => rightPanel.includes(k))).toEqual([]);
  });

  it("agrees with the activity bar on which feature owns each seat", () => {
    for (const [seat, feature] of [
      ...Object.entries(SIDEBAR_PANEL_FEATURE),
      ...Object.entries(RIGHT_PANEL_MODE_FEATURE),
    ]) {
      expect(ACTIVITY_BAR_ITEM_FEATURE[seat]).toBe(feature);
    }
  });
});

describe("isRightPanelUsable (§340 ⓒ)", () => {
  // 스토어 없이 순수 함수 자체를 고정한다 — isActivityBarItemVisible과 같은 이유
  // (activity-bar-feature-gates.test.tsx).
  const allOn = { ai: true, journal: true, tasks: true, zettelkasten: true };
  const allOff = {
    ai: false,
    journal: false,
    tasks: false,
    zettelkasten: false,
  };

  it("follows the owning feature's flag for a gated mode", () => {
    expect(isRightPanelUsable("chat", allOn)).toBe(true);
    expect(isRightPanelUsable("chat", allOff)).toBe(false);
    expect(isRightPanelUsable("memories", { ...allOn, journal: false })).toBe(
      false,
    );
  });

  it("is always true for an unclassified mode (properties), regardless of flags", () => {
    expect(isRightPanelUsable("properties", allOff)).toBe(true);
    expect(isRightPanelUsable("properties", allOn)).toBe(true);
  });

  // C-2's exact shape: ⓐ moves the pointer to "none" but leaves rightPanelOpen true.
  // "none" has no entry in RIGHT_PANEL_MODE_FEATURE, so the feature check alone (without
  // this explicit branch) would pass vacuously and let the empty panel back in.
  it('is always false for mode "none", even with every feature on', () => {
    expect(isRightPanelUsable("none", allOn)).toBe(false);
  });
});

describe("AppLayout right-panel render gate (§340 ⓒ)", () => {
  beforeEach(() => {
    useFileStore.setState({ rootPath: "/vault" });
    useSettingsStore.setState({
      journalEnabled: true,
      tasksEnabled: true,
      zettelkastenEnabled: true,
    });
    useAIStore.setState({ aiEnabled: true });
    useUIStore.setState({
      // Sidebar/FileTree are irrelevant to this gate and pull in their own lazy
      // loads (§4.3) — keep them out so a failure here can only be about the
      // right panel.
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanelMode: "chat",
      rightPanelWidth: 320,
    });
  });

  it("C-2: stops rendering once the owning feature turns off, though rightPanelOpen stays true", () => {
    useUIStore.setState({ rightPanelMode: "chat", rightPanelOpen: true });
    useAIStore.setState({ aiEnabled: false });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".app-right-panel")).toBeNull();
    // The exact shape of this bug: "open" stays true; only visibility is gated.
    expect(useUIStore.getState().rightPanelOpen).toBe(true);
  });

  // I-1/I-2 shape: state is set DIRECTLY (skills-mode restoring a saved pointer, or a
  // custom preset applying a persisted mode) rather than through ⓐ, which only reacts to
  // the four feature-flag deps changing. This pins the render filter as independent of ⓐ.
  it("I-1/I-2 shape: renders nothing for a directly-set stale pointer, without going through ⓐ", () => {
    useSettingsStore.setState({ journalEnabled: false });
    useUIStore.setState({ rightPanelOpen: true, rightPanelMode: "memories" });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".app-right-panel")).toBeNull();
  });

  it("negative control: still renders the panel wrapper when the owning feature is on", () => {
    useUIStore.setState({ rightPanelOpen: true, rightPanelMode: "memories" });
    useSettingsStore.setState({ journalEnabled: true });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".app-right-panel")).not.toBeNull();
  });

  // Independent cross-check, same reasoning as feature-seat-pointer.test.tsx's agreement
  // tests: RIGHT_PANEL_MODE_FEATURE's own agreement with ACTIVITY_BAR_ITEM_FEATURE is
  // already pinned there — this only re-confirms every gated mode this describe block
  // didn't individually cover still resolves through the same predicate AppLayout uses.
  it.each(
    Object.keys(
      RIGHT_PANEL_MODE_FEATURE,
    ) as (keyof typeof RIGHT_PANEL_MODE_FEATURE)[],
  )("hides mode %s when its owning feature is off", (mode) => {
    const feature = RIGHT_PANEL_MODE_FEATURE[mode];
    if (!feature) throw new Error(`unmapped mode: ${mode}`);
    const disable: Record<string, () => void> = {
      ai: () => useAIStore.setState({ aiEnabled: false }),
      journal: () => useSettingsStore.setState({ journalEnabled: false }),
      tasks: () => useSettingsStore.setState({ tasksEnabled: false }),
      zettelkasten: () =>
        useSettingsStore.setState({ zettelkastenEnabled: false }),
    };
    useUIStore.setState({ rightPanelOpen: true, rightPanelMode: mode });
    disable[feature]();
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".app-right-panel")).toBeNull();
  });
});
