// §395 spec 0074 D16 · §7 "계획 B" (대상 · 메뉴) — the real FileTree: which targets a row's menu hands a plugin
// command, that a click on an item closes the menu, and that the empty area's menu has none. The harness is
// `file-tree-tab-sync.test.tsx`'s: the Tauri plugins FileTree imports are stubbed; nothing here calls them.
import type { PluginEntryContributions } from "../../../plugins/plugin-ui-store";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../../../plugins/plugin-host-registry";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { FileTree } from "../FileTree";

const DEMO: PluginEntryContributions = {
  commands: [{ id: "show", title: "Show targets" }],
  fileMenu: [{ command: "show", id: "show" }],
  menu: [],
  name: "Demo",
  pluginId: "demo",
  slash: [],
  trust: "trusted",
};
let seen: unknown[][] = [];
const rowOf = (name: string) =>
  screen.getByText(name).closest<HTMLElement>('[role="treeitem"]')!;
const showTargets = () => fireEvent.click(screen.getByText("Show targets"));

beforeEach(() => {
  useFileStore.setState({
    expandedDirs: new Set(["/r/docs"]),
    fileTree: [
      {
        children: [{ isDir: false, name: "c.md", path: "/r/docs/c.md" }],
        isDir: true,
        name: "docs",
        path: "/r/docs",
      },
      { isDir: false, name: "a.md", path: "/r/a.md" },
      { isDir: false, name: "b.md", path: "/r/b.md" },
    ],
    loadError: null,
    rootPath: "/r",
    tagFilter: null,
  });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  usePluginUIStore.setState({ contributions: { demo: DEMO } });
  registerHostCommandHandler(
    "demo.show",
    (...args) => {
      seen.push(args);
    },
    "demo",
  );
});
afterEach(() => {
  seen = [];
  commandHandlers.clear();
  commandOwners.clear();
  usePluginUIStore.setState({ contributions: {} });
});

describe("FileTree — a plugin item on a row's menu (§395 D16)", () => {
  /** What fails this: `pluginItems` left off the row menu's state, or `onClose` not wired to `setContextMenu(null)`. */
  it("draws the item; a click closes the menu and hands the row", () => {
    const { container } = render(<FileTree />);
    fireEvent.contextMenu(rowOf("b.md"));
    showTargets();
    expect(container.querySelector(".file-tree-context-menu")).toBeNull();
    expect(seen).toEqual([[[{ isDir: false, path: "/r/b.md" }]]]);
  });

  /** What fails this: targets folded like the delete's, or taken from the clicked row alone. */
  it("hands every selected item, in the order selected and unfolded, when the click is inside the selection", () => {
    render(<FileTree />);
    for (const name of ["a.md", "docs", "c.md"])
      fireEvent.click(rowOf(name), { ctrlKey: true });
    fireEvent.contextMenu(rowOf("a.md"));
    showTargets();
    expect(seen).toEqual([
      [
        [
          { isDir: false, path: "/r/a.md" },
          { isDir: true, path: "/r/docs" },
          { isDir: false, path: "/r/docs/c.md" },
        ],
      ],
    ]);
  });

  it("hands the row alone when the click is outside the selection", () => {
    render(<FileTree />);
    for (const name of ["a.md", "docs"])
      fireEvent.click(rowOf(name), { ctrlKey: true });
    fireEvent.contextMenu(rowOf("b.md"));
    showTargets();
    expect(seen).toEqual([[[{ isDir: false, path: "/r/b.md" }]]]);
  });

  /** What fails this: plugin items computed for the empty area's menu too. */
  it("puts no plugin item on the empty area's menu", () => {
    const { container } = render(<FileTree />);
    fireEvent.contextMenu(container.querySelector<HTMLElement>(".file-tree")!);
    expect(screen.getByText("New File")).toBeTruthy();
    expect(screen.queryByText("Show targets")).toBeNull();
  });
});
