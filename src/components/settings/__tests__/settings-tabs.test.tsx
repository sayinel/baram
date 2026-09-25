// §342 — nav groups (General/Features/System) + tab promotion for Journal,
// Zettel, and Tasks. Feature tabs are never hidden (rule 1): hiding one would
// remove the only way to turn that feature back on, so they dim instead.
import type { ReactNode } from "react";

import { render, renderHook, screen } from "@testing-library/react";
import {
  CircleCheck,
  Folder,
  PanelsTopLeft,
  Puzzle,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { beforeEach, describe, expect, it } from "vitest";

import { DIALS } from "../../../appearance/dials";
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

  // 동훈님 요청: 같은 것을 이미 그리는 표면이 있는 설정 탭은 그 표면과 **같은 모양**이어야
  // 한다 — tasks·zettelkasten·plugins 는 활동표시줄(`ActivityBar.tsx` 의 `CircleCheck`·
  // `StickyNote`·`Puzzle`), ai 는 블록 팝업의 AI 버튼(`image-view.tsx`·`callout-view.tsx`·
  // `math-block-view.tsx`·`svg-block-view.tsx` 가 모두 `<Sparkles size={14} />`),
  // activitybar(화면 배치)는 상태 표시줄의 화면구성 버튼(`StatusBar.tsx` 의
  // `PanelsTopLeft`), vault 는 최근 폴더 목록의 볼트 행(`ContextAddMenu.tsx` 의 `Folder`).
  //
  // ‼️ 클래스가 아니라 **경로 자체**를 비교한다: svg 의 `lucide-<이름>` 클래스는
  // `createLucideIcon` 에 넘긴 이름일 뿐이고(실측 `class="lucide lucide-folder"`),
  // 모양이 같다는 증거는 경로뿐이다. 다른 lucide 아이콘으로 바꾸면 iconNode 가 달라
  // 이 단정이 깨진다.
  //
  // ‼️ 이 결합은 **규약이고 파생이 아니다**: `ActivityBar.tsx` 의 `PANEL_ICONS`,
  // NodeView 들의 버튼, 상태 표시줄·최근 폴더 목록의 아이콘은 export 되지 않아 여기서
  // 읽을 수 없다. 즉 그 표면이 자기 아이콘을 바꾸면 이 테스트는 그것을 모른다. 그때는
  // 두 자리를 같이 고쳐야 한다.

  // 동훈님 요청: 설정 아이콘은 전부 lucide 여야 한다. 문자 글리프가 남긴 결함 셋을 규칙
  // 하나로 막는다 — ① 색: `Emoji=Yes` 코드포인트는 주 폰트에 없으면 Apple Color Emoji 로
  // 떨어진다(macOS 에서 📓🗂🧩📦🌐 는 물론 `⚙`(U+2699)·`⌨`(U+2328)도 그랬다) ② 폭: 두
  // 글자 `M↓` 는 20px 칸보다 넓어(0.8rem 에서 실측 22px) 라벨에 붙은 낱말로 읽혔다
  // ③ 굵기: 글리프는 svg 와 선 굵기가 달라 열이 들쭉날쭉했다(`▤ ✎ ◑`). lucide 는
  // `currentColor` 로 stroke 하므로 lucide svg 는 정의상 모노톤이다 — 아무 svg 나 그렇지는
  // 않으므로(여러 색을 칠한 인라인 svg) lucide 가 붙이는 `lucide` 클래스까지 본다.
  //
  // `icon` 이 `ReactElement` 라 문자열 글리프는 컴파일에서 막히지만 `<span>✎</span>` 같은
  // 요소는 통과한다 — 그래서 렌더해서 "lucide svg 가 있고 글자가 없다" 를 본다.
  it("draws every tab icon as a text-free lucide svg", () => {
    const isLucideIcon = (node: ReactNode) => {
      const { container, unmount } = render(<>{node}</>);
      const drawn =
        container.querySelector("svg.lucide") !== null &&
        container.textContent === "";
      unmount();
      return drawn;
    };

    expect(TABS.filter((t) => !isLucideIcon(t.icon)).map((t) => t.id)).toEqual(
      [],
    );

    // 비-공허성: 예전 글리프 모양과 lucide 가 아닌 svg 는 걸리고 lucide 는 통과한다.
    // 이것이 없으면 판정이 무엇이든 참이 되게 망가져도 위 단정이 조용히 통과한다.
    expect(isLucideIcon(<span>✎</span>)).toBe(false);
    expect(isLucideIcon(<span>M↓</span>)).toBe(false);
    expect(
      isLucideIcon(
        <svg>
          <circle fill="red" r="4" />
        </svg>,
      ),
    ).toBe(false);
    expect(isLucideIcon(<Puzzle />)).toBe(true);
  });

  it("draws each tab that has a sibling surface with that surface's icon", () => {
    const shapeOf = (node: ReactNode) => {
      const { container, unmount } = render(<>{node}</>);
      const svg = container.querySelector("svg");
      const html = svg?.innerHTML ?? null;
      unmount();
      return html;
    };

    const tabIcon = (id: string) =>
      shapeOf(TABS.find((t) => t.id === id)?.icon);

    const siblings: [string, ReactNode][] = [
      ["tasks", <CircleCheck key="tasks" />],
      ["zettelkasten", <StickyNote key="zettelkasten" />],
      ["plugins", <Puzzle key="plugins" />],
      ["ai", <Sparkles key="ai" />],
      ["activitybar", <PanelsTopLeft key="activitybar" />],
      ["vault", <Folder key="vault" />],
    ];

    for (const [id, sibling] of siblings) {
      // 문자 글리프(예전 `▤`)는 svg 가 없어 null 이다 — null 끼리 같다고 통과하지 않게 먼저 막는다
      expect(tabIcon(id), id).not.toBeNull();
      expect(tabIcon(id), id).toBe(shapeOf(sibling));
    }

    // 음성 대조군 — 여섯 모양이 서로 다르다. 없으면 "전부 같은 것을 그린다"와
    // 구별되지 않는다(예: 두 탭이 실수로 같은 컴포넌트가 된 경우).
    expect(new Set(siblings.map(([id]) => tabIcon(id))).size).toBe(
      siblings.length,
    );
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

  it("gives every appearance dial a registry entry under its own id", () => {
    // §368 이 남긴 결함의 일반형: 그때 `editorPadding` 의 행은 EditorTab.tsx 에
    // **있었는데** 레지스트리에 항목이 없어서, 설정 검색으로는 찾을 방법이 전혀
    // 없었다. 화면을 열어 눈으로 보면 멀쩡했다는 것이 요점이다 — 그 결함은 오직
    // 검색에서만 보인다.
    //
    // 무엇이 이것을 실패시키는가: `DIALS` 에 다이얼을 더하고 레지스트리에
    // `dialSliderSetting`/열거 항목을 더하지 않으면 실패한다. 이 단정의 전제는
    // `DIALS` 전부가 자기 id 와 같은 id 의 레지스트리 항목을 갖는 것이고, 아래 단정이
    // `DIALS` 를 순회해 그것을 다이얼마다 확인한다 — 항목 id 를 일부러 다르게 지으려면
    // 이 테스트를 함께 고쳐야 한다.
    const { result } = renderHook(() => useSettingsRegistry());
    const registered = new Set(result.current.map((s) => s.id));
    const missing = DIALS.map((d) => d.id).filter((id) => !registered.has(id));
    expect(missing).toEqual([]);
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
