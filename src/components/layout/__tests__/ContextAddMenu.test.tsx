import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../../../stores/context/context";
import { useSettingsStore } from "../../../stores/settings/store";
import { openRecentFile, openRecentFolder } from "../../../utils/recent-open";
import { ContextAddMenu } from "../ContextAddMenu";

vi.mock("../../../utils/recent-open", () => ({
  openRecentFolder: vi.fn(),
  openRecentFile: vi.fn(),
}));

function anchor() {
  return { current: document.createElement("button") };
}

let clearRecent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearRecent = vi.fn();
  useSettingsStore.setState({
    locale: "en",
    clearRecent,
    recentFolders: [
      { path: "/a/MyVault", lastOpened: 2, isVault: true },
      { path: "/b/Notes", lastOpened: 1 },
    ],
    recentFiles: [{ path: "/a/MyVault/todo.md", lastOpened: 3 }],
  } as never);
  useContextStore.setState({ contexts: [] } as never);
});

afterEach(() => {
  useSettingsStore.setState({ recentFolders: [], recentFiles: [] } as never);
  vi.clearAllMocks();
});

describe("ContextAddMenu — recents", () => {
  it("renders folder/file sections with a vault badge", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    expect(screen.getByText("Recent Folders")).toBeInTheDocument();
    expect(screen.getByText("Recent Files")).toBeInTheDocument();
    expect(screen.getByText("MyVault")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("todo.md")).toBeInTheDocument();
    expect(screen.getByText("Vault")).toBeInTheDocument(); // badge on the vault entry
  });

  it("opens a recent folder and closes the menu on click", () => {
    const onClose = vi.fn();
    render(<ContextAddMenu anchorRef={anchor()} onClose={onClose} />);
    fireEvent.click(screen.getByText("MyVault"));
    expect(onClose).toHaveBeenCalled();
    expect(vi.mocked(openRecentFolder)).toHaveBeenCalledWith("/a/MyVault");
  });

  it("opens a recent file on click", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    fireEvent.click(screen.getByText("todo.md"));
    expect(vi.mocked(openRecentFile)).toHaveBeenCalledWith(
      "/a/MyVault/todo.md",
    );
  });

  it("clears recents via the clear action", () => {
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Clear Recent"));
    expect(clearRecent).toHaveBeenCalled();
  });

  it("hides recent sections when there are none", () => {
    useSettingsStore.setState({ recentFolders: [], recentFiles: [] } as never);
    render(<ContextAddMenu anchorRef={anchor()} onClose={() => {}} />);
    expect(screen.queryByText("Recent Folders")).toBeNull();
    expect(screen.queryByText("Clear Recent")).toBeNull();
  });
});
