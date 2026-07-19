import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileTreeSortDropdown } from "../FileTreeSortDropdown";

describe("FileTreeSortDropdown", () => {
  it("opens the menu and calls onChange with the picked order", () => {
    const onChange = vi.fn();
    render(<FileTreeSortDropdown onChange={onChange} value="name-asc" />);

    fireEvent.click(screen.getByRole("button", { name: /sort/i }));
    fireEvent.click(screen.getByText(/modified \(newest\)/i));

    expect(onChange).toHaveBeenCalledWith("mtime-desc");
  });

  it("marks the active order as selected", () => {
    render(<FileTreeSortDropdown onChange={vi.fn()} value="name-desc" />);
    fireEvent.click(screen.getByRole("button", { name: /sort/i }));
    const active = screen.getByRole("option", { selected: true });
    expect(active).toHaveTextContent(/name \(z–a\)/i);
  });
});
