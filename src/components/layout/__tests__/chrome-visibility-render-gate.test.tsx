// §370 표면 가시성이 실제로 "렌더하지 않는다"로 이어지는지 고정한다 — CSS `display: none`이
// 아니라 언마운트여야 하는 이유는 ui.ts의 §370 주석과 task-2-brief.md의 ‼️ 항목이 말한다:
// 렌더된 채로 숨기면 포커스 순서·스크린리더 트리에 그대로 남는다. 여기서는 그 반대,
// 즉 DOM에서 완전히 빠지는지를 querySelector로 고정한다(잔존 요소가 있으면 null이 아니다).
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { AppLayout } from "../AppLayout";

describe("AppLayout activity bar render gate (§370)", () => {
  beforeEach(() => {
    useFileStore.setState({ rootPath: "/vault" });
    useUIStore.setState({
      activityBarVisible: true,
      sidebarOpen: false,
      rightPanelOpen: false,
    });
  });

  it("does not render .activity-bar when activityBarVisible is false", () => {
    useUIStore.setState({ activityBarVisible: false });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".activity-bar")).toBeNull();
  });

  it("negative control: renders .activity-bar when activityBarVisible is true and rootPath is set", () => {
    useUIStore.setState({ activityBarVisible: true });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".activity-bar")).not.toBeNull();
  });

  it("still hides when no folder is open, independent of activityBarVisible", () => {
    useFileStore.setState({ rootPath: null });
    useUIStore.setState({ activityBarVisible: true });
    const { container } = render(<AppLayout>{null}</AppLayout>);
    expect(container.querySelector(".activity-bar")).toBeNull();
  });
});
