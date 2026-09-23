// §370.2 복귀 경로 ② 가장자리 호버 — 게이트는 컴포넌트 안이 아니라 마운트 자리
// (AppLayout.tsx)에 있다. `ChromeReveal` 자신은 세 크롬 플래그만 보고, `rootPath`는
// 모른다(독립 렌더 테스트인 chrome-reveal.test.tsx가 그 계약을 고정한다) — 그런데
// `ChromeReveal`이 되살리는 세 표면(ActivityBar/StatusBar/TabBar)은 전부 `!!rootPath`로도
// 게이트돼 있으므로, 폴더가 열려 있지 않을 때 이 버튼만 홀로 뜨면 되살릴 것이 없는
// 약속을 하게 된다. 이 파일은 AppLayout이 그 조합을 실제로 어떻게 처리하는지 고정한다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { AppLayout } from "../AppLayout";

describe("AppLayout §370.2 ChromeReveal mount gate", () => {
  beforeEach(() => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
      sidebarOpen: false,
      rightPanelOpen: false,
    });
  });

  it("does not render .chrome-reveal when no folder is open, even with all three flags hidden", () => {
    useFileStore.setState({ rootPath: null });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".chrome-reveal")).toBeNull();
  });

  it("positive control: renders .chrome-reveal when a folder is open and all three flags are hidden", () => {
    useFileStore.setState({ rootPath: "/vault" });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".chrome-reveal")).not.toBeNull();
  });

  it("is the first element inside .app-layout, so Tab reaches it before every other focusable", () => {
    useFileStore.setState({ rootPath: "/vault" });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    const appLayout = container.querySelector(".app-layout");
    expect(appLayout?.firstElementChild).toHaveClass("chrome-reveal");
  });
});
