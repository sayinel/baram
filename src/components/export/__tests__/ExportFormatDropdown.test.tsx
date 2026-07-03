import type { ExportFormatGroup } from "../ExportFormatDropdown";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportFormatDropdown } from "../ExportFormatDropdown";

const groups: ExportFormatGroup[] = [
  {
    label: "웹",
    options: [
      {
        id: "html",
        ext: ".html",
        name: "HTML",
        desc: "Standalone page",
        pandoc: false,
      },
      {
        id: "pdf",
        ext: ".pdf",
        name: "PDF",
        desc: "Print-ready",
        pandoc: false,
      },
    ],
  },
  {
    label: "문서 (Pandoc)",
    options: [
      {
        id: "docx",
        ext: ".docx",
        name: "Word",
        desc: "Editable",
        pandoc: true,
      },
    ],
  },
];

describe("ExportFormatDropdown", () => {
  it("shows the current format on the trigger button", () => {
    render(
      <ExportFormatDropdown
        groups={groups}
        onChange={() => {}}
        pandocAvailable
        value="pdf"
      />,
    );
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument();
  });

  it("opens the popup and selects a format via onChange", () => {
    const onChange = vi.fn();
    render(
      <ExportFormatDropdown
        groups={groups}
        onChange={onChange}
        pandocAvailable
        value="html"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /HTML/ }));
    fireEvent.click(screen.getByText("Word"));
    expect(onChange).toHaveBeenCalledWith("docx");
  });

  it("disables pandoc options when pandoc is unavailable", () => {
    const onChange = vi.fn();
    render(
      <ExportFormatDropdown
        groups={groups}
        onChange={onChange}
        pandocAvailable={false}
        value="html"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /HTML/ }));
    fireEvent.click(screen.getByText("Word"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
