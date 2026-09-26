// §4.8 — MenuList presentational context-menu list.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { MenuList } from "../toolbar/MenuList";

describe("MenuList", () => {
  it("renders items and separators", () => {
    render(
      <MenuList
        items={[
          { label: "One", action: () => {} },
          { label: "", action: () => {}, separator: true },
          { label: "Two", action: () => {} },
        ]}
        onClose={() => {}}
        x={10}
        y={10}
      />,
    );
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
    expect(document.querySelector(".context-menu-separator")).toBeTruthy();
  });

  it("runs the action then closes on click", () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(
      <MenuList
        items={[{ label: "Go", action }]}
        onClose={onClose}
        x={0}
        y={0}
      />,
    );
    fireEvent.click(screen.getByText("Go"));
    expect(action).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <MenuList
        items={[{ label: "Go", action: () => {} }]}
        onClose={onClose}
        x={0}
        y={0}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("MenuList — checked items", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: "en" });
  });

  it("marks a checked item with a named check icon, not a glyph in its label", () => {
    // 라벨 뒤의 " ✓" 는 글자라 적어도 읽혔다. lucide 아이콘은 스스로 aria-hidden 이므로
    // 선택 상태는 아이콘 자신의 이름(`role="img"`)으로 남아야 한다 — PR #739 의 배지와 같다.
    render(
      <MenuList
        items={[
          { action: () => {}, checked: true, label: "Small" },
          { action: () => {}, label: "Large" },
        ]}
        onClose={() => {}}
        x={0}
        y={0}
      />,
    );
    const small = screen.getByRole("button", { name: /Small/ });
    expect(
      within(small).getByRole("img", { name: "Selected" }),
    ).toBeInTheDocument();
    expect(small.textContent?.trim()).toBe("Small");
    // 음성 대조: 선택되지 않은 항목에는 아이콘이 없다.
    const large = screen.getByRole("button", { name: /Large/ });
    expect(within(large).queryByRole("img")).toBeNull();
  });

  it("names the check in the current locale", () => {
    useSettingsStore.setState({ locale: "ko" });
    render(
      <MenuList
        items={[{ action: () => {}, checked: true, label: "Small" }]}
        onClose={() => {}}
        x={0}
        y={0}
      />,
    );
    expect(screen.getByRole("img", { name: "선택됨" })).toBeInTheDocument();
  });
});
