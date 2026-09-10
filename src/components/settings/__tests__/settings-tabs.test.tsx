// §342 — nav groups (General/Features/System) + tab promotion for Journal,
// Zettel, and Tasks. Feature tabs are never hidden (rule 1): hiding one would
// remove the only way to turn that feature back on, so they dim instead.
import type { ReactNode } from "react";

import { render, renderHook, screen } from "@testing-library/react";
import { CircleCheck, Sparkles } from "lucide-react";
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

  // 동훈님 요청: 설정 탭의 두 아이콘은 다른 표면과 **같은 모양**이어야 한다 —
  // tasks 는 활동표시줄의 태스크 아이콘(`ActivityBar.tsx` 의 `CircleCheck`), ai 는
  // 블록 팝업의 AI 버튼(`image-view.tsx`·`callout-view.tsx`·`math-block-view.tsx`·
  // `svg-block-view.tsx` 가 모두 `<Sparkles size={14} />`).
  //
  // ‼️ 클래스로 판별할 수 없다: 이 lucide 버전은 svg 에 `"lucide"` 하나만 붙이고
  // 아이콘별 클래스를 붙이지 않는다(`mergeClasses("lucide", contextClass, className)`).
  // 그래서 **경로 자체**를 비교한다 — 그것만이 모양이 같다는 증거다. 다른 lucide
  // 아이콘으로 바꾸면 iconNode 가 달라 이 단정이 깨진다.
  //
  // ‼️ 이 결합은 **규약이고 파생이 아니다**: `ActivityBar.tsx` 의 `PANEL_ICONS` 와
  // NodeView 들의 버튼은 export 되지 않아 여기서 읽을 수 없다. 즉 활동표시줄이 자기
  // 아이콘을 바꾸면 이 테스트는 그것을 모른다. 그때는 두 자리를 같이 고쳐야 한다.
  // 동훈님 요청: 설정 아이콘은 전부 모노톤이어야 한다. 컬러가 새어 들어오는 경로는
  // **이모지 폴백** 하나다 — 문자 글리프 중 `Emoji=Yes` 인 코드포인트는 주 폰트에
  // 없으면 Apple Color Emoji 로 떨어져 컬러로 그려진다(macOS 에서 실제로 그랬다:
  // 📓🗂🧩📦🌐 는 물론이고 `⚙`(U+2699)·`⌨`(U+2328)도 `Emoji=Yes` 다).
  //
  // 그래서 목록을 베끼지 않고 **규칙**으로 고정한다: 어떤 탭 아이콘도 Emoji 코드포인트를
  // 담지 않는다. 남아 있는 `✎ ◑ M↓ ▤` 는 측정으로 `Emoji=No` 이므로 통과한다.
  // lucide 는 `currentColor` 로 stroke 하므로 컴포넌트 쪽은 정의상 모노톤이다.
  it("draws no tab icon with an emoji codepoint — colour can only enter that way", () => {
    const emoji = /\p{Emoji}/u;
    const offenders = TABS.filter(
      (t) => typeof t.icon === "string" && emoji.test(t.icon),
    ).map((t) => `${t.id}=${String(t.icon)}`);

    expect(offenders).toEqual([]);

    // 비-공허성: 검사가 실제로 이모지를 판별한다. 이것이 없으면 정규식이 아무것도
    // 매치하지 못하게 망가져도 위 단정이 조용히 통과한다.
    expect(emoji.test("📓")).toBe(true);
    expect(emoji.test("⚙")).toBe(true);
    expect(emoji.test("◑")).toBe(false);
  });

  it("draws the tasks and ai tabs with the icons their sibling surfaces use", () => {
    const shapeOf = (node: ReactNode) => {
      const { container, unmount } = render(<>{node}</>);
      const svg = container.querySelector("svg");
      const html = svg?.innerHTML ?? null;
      unmount();
      return html;
    };

    const tabIcon = (id: string) =>
      shapeOf(TABS.find((t) => t.id === id)?.icon);

    expect(tabIcon("tasks")).not.toBeNull();
    expect(tabIcon("tasks")).toBe(
      shapeOf(<CircleCheck size={14} strokeWidth={1.5} />),
    );
    expect(tabIcon("ai")).toBe(
      shapeOf(<Sparkles size={14} strokeWidth={1.5} />),
    );

    // 음성 대조군 — 두 아이콘이 서로 다르다. 없으면 "둘 다 같은 것을 그린다"와
    // 구별되지 않는다(예: 양쪽이 실수로 같은 컴포넌트가 된 경우).
    expect(tabIcon("tasks")).not.toBe(tabIcon("ai"));
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
