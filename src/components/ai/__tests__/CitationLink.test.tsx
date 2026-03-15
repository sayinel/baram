// §11.4 CitationLink — citation badge for knowledge Q&A results
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { CitationLink } from "../CitationLink";

describe("CitationLink", () => {
  it("renders citation number and file path", () => {
    render(
      <CitationLink filePath="docs/auth.md" heading="JWT 검증" index={1} />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("docs/auth.md#JWT-검증")).toBeInTheDocument();
  });

  it("renders file path without heading anchor when heading is empty", () => {
    render(<CitationLink filePath="docs/intro.md" heading="" index={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("docs/intro.md")).toBeInTheDocument();
  });

  it('renders "열기" button', () => {
    render(
      <CitationLink filePath="docs/auth.md" heading="JWT 검증" index={1} />,
    );
    expect(screen.getByText("열기")).toBeInTheDocument();
  });

  it("calls openTab when 열기 button is clicked", () => {
    const mockOpenTab = vi.fn();
    const originalGetState = useEditorStore.getState;
    vi.spyOn(useEditorStore, "getState").mockReturnValue({
      ...originalGetState(),
      openTab: mockOpenTab,
    });

    render(
      <CitationLink filePath="docs/auth.md" heading="JWT 검증" index={1} />,
    );
    fireEvent.click(screen.getByText("열기"));
    expect(mockOpenTab).toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
