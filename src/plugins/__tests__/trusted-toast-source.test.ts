// §385 spec 0061 §8 — the trusted toast badge now goes through the same name function as the
// sandboxed one: sanitised and capped. It used to be `displayName?.trim() || pluginId`.
import type { PluginCapability } from "../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../stores/ui/ui";
import { createUIAPI } from "../trusted/ui-api";

describe("trusted showNotification attribution", () => {
  const original = useUIStore.getState().showToast;
  afterEach(() => useUIStore.setState({ showToast: original }));

  it("sanitises and caps the name it badges the toast with", () => {
    const showToast = vi.fn();
    useUIStore.setState({ showToast });
    createUIAPI(
      "p",
      new Set<PluginCapability>(["statusbar"]),
      [],
      `Na\u202eme${"x".repeat(40)}`,
    ).showNotification("hi");
    const source = showToast.mock.calls[0][2] as string;
    expect(source).not.toContain("\u202e");
    expect(source.length).toBe(32);
  });
});
