// §4.8 — MenuList presentational context-menu list.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
