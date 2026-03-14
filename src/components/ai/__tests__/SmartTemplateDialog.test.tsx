// §11.8 SmartTemplateDialog — template selection grid for Smart Templates
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SmartTemplateDialog } from "../SmartTemplateDialog";

describe("SmartTemplateDialog", () => {
  it("renders template selection grid", () => {
    render(<SmartTemplateDialog isOpen onClose={() => {}} />);
    expect(screen.getByText("API Documentation")).toBeInTheDocument();
    expect(screen.getByText("Meeting Notes")).toBeInTheDocument();
  });

  it("calls onGenerate with selected template id", () => {
    const onGenerate = vi.fn();
    render(
      <SmartTemplateDialog isOpen onClose={() => {}} onGenerate={onGenerate} />,
    );
    fireEvent.click(screen.getByText("API Documentation"));
    expect(onGenerate).toHaveBeenCalledWith("api-doc");
  });

  it("shows Custom option with text input", () => {
    render(<SmartTemplateDialog isOpen onClose={() => {}} />);
    expect(screen.getByText("Custom...")).toBeInTheDocument();
  });
});
