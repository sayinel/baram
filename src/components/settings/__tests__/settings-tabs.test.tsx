// §342 — nav groups (General/Features/System) + tab promotion for Journal,
// Zettel, and Tasks. Feature tabs are never hidden (rule 1): hiding one would
// remove the only way to turn that feature back on, so they dim instead.
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { useSettingsRegistry } from "../settings-registry";
import { SETTINGS_TAB_GROUPS, SettingsModal, TABS } from "../SettingsModal";

describe("settings tab structure (§342)", () => {
  it("assigns every tab to exactly one group", () => {
    // 소진 산술 — 새 탭을 그룹 배정 없이 추가하면 실패한다
    const assigned = SETTINGS_TAB_GROUPS.flatMap((g) =>
      TABS.filter((t) => t.group === g.id).map((t) => t.id),
    );
    expect(assigned.sort()).toEqual(TABS.map((t) => t.id).sort());
    expect(new Set(assigned).size).toBe(TABS.length);
  });

  it("keeps the SettingsTab union and TABS in agreement", () => {
    const { result } = renderHook(() => useSettingsRegistry());
    const registryTabs = new Set(result.current.map((s) => s.category));
    const tabIds = new Set(TABS.map((t) => t.id));
    for (const cat of registryTabs) {
      expect(tabIds).toContain(cat);
    }
  });

  it("leaves no feature setting in the general category", () => {
    // 옮기다 만 항목은 검색에서 엉뚱한 탭으로 이동한다
    const { result } = renderHook(() => useSettingsRegistry());
    const strays = result.current.filter(
      (s) =>
        s.category === "general" && /journal|zettelkasten|tasks/i.test(s.id),
    );
    expect(strays.map((s) => s.id)).toEqual([]);
  });

  it("registers the zettelkasten and ai enable toggles in search", () => {
    const { result } = renderHook(() => useSettingsRegistry());
    const ids = result.current.map((s) => s.id);
    expect(ids).toContain("zettelkastenEnabled");
    expect(ids).toContain("aiEnabled");
  });
});

describe("feature tabs are never hidden (§342 rule 1)", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      journalEnabled: false,
      tasksEnabled: false,
      zettelkastenEnabled: false,
    });
    useAIStore.setState({ aiEnabled: false });
    useUIStore.setState({ settingsOpen: true });
  });

  it("renders all four feature tabs with every feature turned off", () => {
    // 숨기면 되켤 방법이 없어진다 — 이 설계에서 유일한 '숨기지 않는' 표면
    render(<SettingsModal />);
    for (const name of ["Journal", "Tasks", "Zettel", "AI"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(name) }),
      ).toBeInTheDocument();
    }
  });

  it("marks a disabled feature's tab as off", () => {
    render(<SettingsModal />);
    const journal = screen.getByRole("button", { name: /Journal/ });
    expect(journal.className).toContain("settings-nav-item--off");
  });

  it("does not mark an enabled feature's tab as off", () => {
    useSettingsStore.setState({ journalEnabled: true });
    render(<SettingsModal />);
    const journal = screen.getByRole("button", { name: /Journal/ });
    expect(journal.className).not.toContain("settings-nav-item--off");
  });
});
