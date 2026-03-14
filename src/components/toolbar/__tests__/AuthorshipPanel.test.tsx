// §11.7 AuthorshipPanel — stats display component tests
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuthorshipPanel } from "../AuthorshipPanel";

describe("AuthorshipPanel", () => {
  it("shows percentage breakdown", () => {
    render(
      <AuthorshipPanel
        stats={{
          aiGeneratedPercent: 20,
          aiModifiedPercent: 10,
          humanPercent: 70,
        }}
      />,
    );
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("shows progress bar segments", () => {
    const { container } = render(
      <AuthorshipPanel
        stats={{
          aiGeneratedPercent: 30,
          aiModifiedPercent: 20,
          humanPercent: 50,
        }}
      />,
    );
    const bars = container.querySelectorAll(".authorship-bar-segment");
    expect(bars.length).toBe(3);
  });
});
