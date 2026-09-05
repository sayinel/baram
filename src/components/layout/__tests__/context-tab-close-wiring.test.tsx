// §82 Wiring: every close door in the context tab bar must go through the shared
// guard. Without this, reverting any of these handlers to a bare `removeContext`
// leaves the whole suite green — the change's central claim would be asserted only
// in prose.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../hooks/use-close-guard", () => ({
  requestCloseContexts: vi.fn(async () => undefined),
}));

vi.mock("../../../services/vault-context-loader", () => ({
  addFolder: vi.fn(async () => undefined),
  switchContext: vi.fn(async () => undefined),
}));

import { requestCloseContexts } from "../../../hooks/use-close-guard";
import { useContextStore } from "../../../stores/context/context";
import { ContextTabBar } from "../ContextTabBar";

function ctx(id: string, contextType: "file" | "vault" = "vault") {
  return {
    id,
    addedAt: 0,
    color: "#ffffff",
    contextType,
    label: `label-${id}`,
    path: `/vault/${id}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useContextStore.setState({
    activeContextId: "a",
    // `f` is a §89 FileContext: never rendered as a tab (the bar filters it out).
    contexts: [ctx("a"), ctx("b"), ctx("f", "file")],
  } as never);
});

/** Open the right-click menu on the tab whose label is `label-<id>`. */
function openContextMenu(id: string) {
  fireEvent.contextMenu(screen.getByText(`label-${id}`));
}

describe("ContextTabBar close doors", () => {
  it("the x button asks the guard, not the store", () => {
    render(<ContextTabBar />);

    fireEvent.click(screen.getAllByTitle("Close")[0]);

    expect(requestCloseContexts).toHaveBeenCalledWith(["a"]);
  });

  it("the context menu's Close asks the guard", () => {
    render(<ContextTabBar />);
    openContextMenu("b");

    fireEvent.click(screen.getByText("Close"));

    expect(requestCloseContexts).toHaveBeenCalledWith(["b"]);
  });

  it("Close Others passes the other TABS — never the hidden FileContext", () => {
    render(<ContextTabBar />);
    openContextMenu("a");

    fireEvent.click(screen.getByText("Close Others"));

    // Discriminating: `f` is open and is "other", but it is not a tab in this bar.
    // Sweeping it in would close a file the user opened from outside the vault,
    // from a menu that never listed it.
    expect(requestCloseContexts).toHaveBeenCalledWith(["b"]);
  });
});
