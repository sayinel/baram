// TemplatePathRow — DOM-identity pin. GeneralTab's five browse/clear rows
// were hand-written JSX before the general/TemplatePathRow.tsx extraction;
// this pins the exact markup (classes, input attrs, button count/order) so a
// future edit to the shared row can't silently change what other CSS/e2e
// coverage depends on.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { GeneralTab } from "../tabs/GeneralTab";

const initialState = useSettingsStore.getState();

afterEach(() => {
  useSettingsStore.setState(initialState, true);
});

describe("GeneralTab — TemplatePathRow DOM shape", () => {
  it("renders the journal directory row with Browse only (no Clear)", () => {
    useSettingsStore.setState({
      ...initialState,
      journalDirectory: "",
      journalEnabled: true,
      locale: "en",
    });
    render(<GeneralTab />);

    const label = screen.getByText("Journal Directory");
    const row = label.closest(".settings-row");
    const keyRow = row?.querySelector(".settings-key-row");
    expect(keyRow).not.toBeNull();

    const input = keyRow?.querySelector(
      "input.settings-input.settings-input-key",
    );
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("");

    const buttons = keyRow?.querySelectorAll("button.settings-key-toggle");
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]).toHaveTextContent("Browse");
  });

  it("renders the journal template row with Browse + Clear once a value is set", () => {
    useSettingsStore.setState({
      ...initialState,
      journalEnabled: true,
      journalTemplatePath: "/vault/template.md",
      locale: "en",
    });
    render(<GeneralTab />);

    const label = screen.getByText("Template");
    const row = label.closest(".settings-row");
    const keyRow = row?.querySelector(".settings-key-row");
    expect(keyRow).not.toBeNull();

    const input = keyRow?.querySelector(
      "input.settings-input.settings-input-key",
    );
    expect(input).toHaveAttribute("readonly");
    expect(input).toHaveValue("/vault/template.md");

    const buttons = keyRow?.querySelectorAll("button.settings-key-toggle");
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]).toHaveTextContent("Browse");
    expect(buttons?.[1]).toHaveTextContent("Clear");
  });

  it("omits the Clear button when the template path is empty", () => {
    useSettingsStore.setState({
      ...initialState,
      journalEnabled: true,
      journalTemplatePath: "",
      locale: "en",
    });
    render(<GeneralTab />);

    const label = screen.getByText("Template");
    const row = label.closest(".settings-row");
    const keyRow = row?.querySelector(".settings-key-row");

    const buttons = keyRow?.querySelectorAll("button.settings-key-toggle");
    expect(buttons).toHaveLength(1);
    expect(buttons?.[0]).toHaveTextContent("Browse");
  });
});
