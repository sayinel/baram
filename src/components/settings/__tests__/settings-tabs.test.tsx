// §342 — nav groups (General/Features/System) + tab promotion for Journal,
// Zettel, and Tasks. Feature tabs are never hidden (rule 1): hiding one would
// remove the only way to turn that feature back on, so they dim instead.
import { render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { FEATURE_KEYS } from "../../../stores/settings/feature-keys";
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

  // ‼️ 이름을 실제 방향으로 좁혔다(M-8). 이 단정은 레지스트리 → TABS **한 방향**만
  // 본다. 역방향(TABS 에 있는데 레지스트리 항목이 없는 탭)은 결함이 아니다 —
  // 검색 레지스트리에 실릴 설정이 없는 탭도 정당하다(예: 그 탭의 내용이 전부
  // 커스텀 UI 인 경우). "in agreement" 는 양방향을 주장했으므로 거짓이었다.
  it("points every registry category at a tab that exists", () => {
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
    // ‼️ 기능 목록을 손으로 열거하지 않고 `FEATURE_KEYS` 에서 **파생**시킨다(M-8):
    // 예전 형태는 `/journal|zettelkasten|tasks/i` 였고 `ai` 가 빠져 있었으며, 다섯 번째
    // 기능이 생겨도 이 검사는 조용히 그걸 안 봤다 — §337 함정 (2)가 경고한 모양이다.
    //
    // 접두사 매칭인 이유: 레지스트리 id 는 설정 스토어 키(`journalEnabled`·`tasksHome`·
    // `zettelkastenEnabled`)라 접두사가 소유를 정확히 가리킨다. 부분 문자열이면
    // `ai` 가 `detail` 같은 무관한 id 에 걸린다.
    //
    // ‼️ 이건 여전히 **이름 기반 대리물**이다. 레지스트리 항목에 기능 소유를 선언하는
    // 필드가 없기 때문이다(현재 44개 항목 중 0개). 그 필드가 생기면 이 검사는 그것에서
    // 파생시켜야 한다 — 이름 규약이 깨지는 순간 이 검사는 조용히 아무것도 안 잡는다.
    const strays = result.current.filter(
      (s) =>
        s.category === "general" &&
        FEATURE_KEYS.some((f) => s.id.startsWith(f)),
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
