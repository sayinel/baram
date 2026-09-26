// §370 — 끄는 동안 행은 자기 클래스(activity-bar-config-row)와 activity-bar-dragging 을
// **둘 다** 가져야 한다. 템플릿이 공백 없이 이어 붙이면 둘이 한 단어가 되어 행이
// `.activity-bar-config-row` 규칙(flex 등)과 `.activity-bar-dragging`(opacity 0.35)을 함께 잃는다.
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../../stores/settings/store";
import { ActivityBarItemsSection } from "../ActivityBarItemsSection";

beforeEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("ActivityBarItemsSection — the dragged row", () => {
  it("keeps its own class while it is being dragged", () => {
    const { container } = render(<ActivityBarItemsSection />);
    const handle = container.querySelector<HTMLElement>(
      ".activity-bar-config-drag-handle",
    );
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle!);
    const row = handle!.closest(".settings-row");
    expect(row?.classList.contains("activity-bar-config-row")).toBe(true);
    expect(row?.classList.contains("activity-bar-dragging")).toBe(true);
    fireEvent.pointerUp(document);
  });
});
