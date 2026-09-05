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

describe("TemplatePathRow — reading a long path", () => {
  /**
   * jsdom lays nothing out, so an input's scrollWidth is 0 and the parking effect would be
   * indistinguishable from doing nothing. Faking the overflow is what makes the assertion able
   * to fail — and it also fails if the ref never reaches the input, which is the quiet way this
   * breaks: `Tooltip` clones the child and sets its own ref, so a forwarding mistake there
   * leaves the effect holding null and the field silently parked at the start.
   */
  function withOverflow(scrollWidth: number) {
    const proto = HTMLInputElement.prototype as unknown as Record<
      string,
      unknown
    >;
    const original = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
    Object.defineProperty(proto, "scrollWidth", {
      configurable: true,
      get: () => scrollWidth,
    });
    return () => {
      if (original) Object.defineProperty(proto, "scrollWidth", original);
      else delete proto.scrollWidth;
    };
  }

  it("parks the field at the end of the path, where the folder name is", () => {
    const restore = withOverflow(640);
    try {
      useSettingsStore.setState({
        ...initialState,
        journalDirectory: "/Users/someone/Documents/Notes/vault/daily/journal",
        journalEnabled: true,
        locale: "en",
      });
      render(<GeneralTab />);

      const input = screen.getByLabelText("Journal Directory");
      expect(input).toHaveProperty("scrollLeft", 640);
    } finally {
      restore();
    }
  });

  it("gives the field a name of its own, not the path it holds", () => {
    // The tooltip names its trigger for assistive tech, which is right for an icon-only button
    // and wrong here: it would announce this field as "/Users/…/journal".
    useSettingsStore.setState({
      ...initialState,
      journalDirectory: "/Users/someone/Notes/journal",
      journalEnabled: true,
      locale: "en",
    });
    render(<GeneralTab />);

    expect(screen.getByLabelText("Journal Directory")).toHaveValue(
      "/Users/someone/Notes/journal",
    );
  });

  it("uses the wider path row, not the API-key width", () => {
    useSettingsStore.setState({
      ...initialState,
      journalDirectory: "",
      journalEnabled: true,
      locale: "en",
    });
    render(<GeneralTab />);

    const row = screen.getByText("Journal Directory").closest(".settings-row");
    expect(row?.querySelector(".settings-key-row")).toHaveClass(
      "settings-key-row--path",
    );
  });
});
