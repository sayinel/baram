import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginConsentDialog } from "../PluginConsentDialog";

const base = {
  name: "Demo",
  reason: "first-install" as const,
};

describe("PluginConsentDialog (§260 Phase 5)", () => {
  it("lists every requested capability", () => {
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor", "network"], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/문서를 읽고 수정할 수 있습니다/)).toBeTruthy();
    expect(screen.getByText(/네트워크 요청을 보낼 수 있습니다/)).toBeTruthy();
  });

  it("gates a trusted install behind an explicit acknowledgement", () => {
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "trusted" }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: /install/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("warns that the capability list does not bound a trusted plugin", () => {
    // The whole point of the danger copy: for `trusted`, the capability list below it
    // is descriptive, not a boundary. A user who reads only the list is misinformed.
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor"], trust: "trusted" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/does not limit it/i);
  });

  it("needs no acknowledgement for a sandboxed install", () => {
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor"], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /install/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("marks only the capabilities the update adds", () => {
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor", "network"], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        prior={{ capabilities: ["editor"], trust: "sandboxed" }}
        reason="escalation"
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).not.toContain("NEW");
    expect(rows[1].textContent).toContain("NEW");
  });

  it("does not mark anything NEW on a first install", () => {
    // Without `prior` there is nothing to diff against, so marking every row NEW
    // would be noise that makes the real marker meaningless on updates.
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["editor"], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("listitem").textContent).not.toContain("NEW");
  });

  it("treats a readonly narrowing as already covered, not as NEW", () => {
    // `files` implies `files:readonly` (see plugin-consent.ts), so an update that
    // narrows must not be presented as asking for something new.
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: ["files:readonly"], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        prior={{ capabilities: ["files"], trust: "sandboxed" }}
        reason="escalation"
      />,
    );
    expect(screen.getByRole("listitem").textContent).not.toContain("NEW");
  });

  it("says what it will do — install versus update", () => {
    const { unmount } = render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading").textContent).toMatch(/install/i);
    unmount();

    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "sandboxed" }}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        reason="escalation"
      />,
    );
    expect(screen.getByRole("heading").textContent).toMatch(/update/i);
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "sandboxed" }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels on Escape — a dismissed dialog must never mean consent", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <PluginConsentDialog
        {...base}
        consent={{ capabilities: [], trust: "sandboxed" }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
