// §370.2 복귀 경로 ② — 가장자리 호버/포커스로 숨긴 크롬을 되살리는 두 번째 경로.
// 무엇이 이것을 실패시키는가: 조건을 "하나라도 숨음"으로 쓰면 평소 화면에 띠가
// 상주한다("표면이 하나라도 보이면 띠가 없다" 테스트가 그 회귀를 잡는다). 버튼이
// 아니라 div+onMouseEnter로 만들면 포커스로 도달할 수 없다("포커스만으로도 화면에
// 나타난다" 테스트 대신, 여기서는 그 전제 — DOM에 남아 실제로 포커스 가능한가 —
// 를 `.focus()` 뒤 `document.activeElement`로 직접 확인한다. jsdom은 `:hover`·
// `:focus-visible` 의사 클래스를 실제로 평가하지 않으므로 CSS 계산값이 아니라
// DOM 트리·포커스 가능성으로 "숨겨도 도달 가능"을 고정한다).
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../../../stores/ui/ui";
import { ChromeReveal } from "../chrome-reveal";

describe("ChromeReveal (§370.2)", () => {
  beforeEach(() => {
    useUIStore.setState({
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    });
  });

  it("표면이 하나라도 보이면 띠가 없다", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: true,
      tabBarVisible: false,
    });
    render(<ChromeReveal />);
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
  });

  it("전부 숨으면 띠가 뜨고, 누르면 전부 되돌아온다", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
    render(<ChromeReveal />);
    fireEvent.click(screen.getByRole("button", { name: /reveal/i }));
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(true);
    expect(s.statusBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  it("전부 숨어도 버튼은 DOM에 남아 포커스로 도달할 수 있다 — 시각적으로만 숨겨야 한다", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });
    render(<ChromeReveal />);
    const button = screen.getByRole("button", { name: /reveal/i });
    expect(button.tabIndex).not.toBe(-1);
    expect(button).not.toHaveAttribute("disabled");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("사이드바·우측 패널 상태는 조건에 관여하지 않는다 — 코퍼스는 세 크롬 표면뿐이다", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
      sidebarOpen: true,
      rightPanelOpen: true,
    });
    render(<ChromeReveal />);
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeNull();
  });
});
