// §394 spec 0073 D4 — when the consent carries languages (a dev folder, an update's claim, or the
// post-download re-ask), the dialog shows them, and marks the ones the previous record did not
// hold — by the same rule `consentGaps` uses (`newCodeBlockLangs`).
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { withinSurface } from "../../../__tests__/helpers/security-surface";
import { PluginConsentDialog } from "../PluginConsentDialog";

const surface = () => withinSurface(".plugin-consent");

describe("PluginConsentDialog — code block languages", () => {
  /** What fails this: not rendering `consent.codeBlocks`, or a NEW marker on a language the
   *  record already held. */
  it("lists the languages and marks only the new ones", () => {
    render(
      <PluginConsentDialog
        consent={{
          capabilities: ["codeblocks"],
          codeBlocks: ["backlinks", "chart"],
          trust: "sandboxed",
        }}
        intent="update"
        name="Demo"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        prior={{
          capabilities: ["codeblocks"],
          codeBlocks: ["backlinks"],
          trust: "sandboxed",
        }}
      />,
    );
    expect(surface().getByText("backlinks")).toBeTruthy();
    const chart = surface().getByText("chart");
    expect(chart.closest("li")?.textContent).toMatch(/NEW/);
    expect(
      surface().getByText("backlinks").closest("li")?.textContent,
    ).not.toMatch(/NEW/);
  });

  /** The pair: a consent without languages (an install's claim) shows no language list. */
  it("shows no language list for a consent without languages", () => {
    render(
      <PluginConsentDialog
        consent={{ capabilities: ["codeblocks"], trust: "sandboxed" }}
        intent="install"
        name="Demo"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(surface().queryByText(/code blocks it draws/i)).toBeNull();
  });
});
