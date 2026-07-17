import type { GraphNodeMenuTarget } from "../graph-context-menu";

// §30.3b Graph node context menu — item composition tests
import { describe, expect, it, vi } from "vitest";

import { buildGraphNodeMenu, nodeClipboardText } from "../graph-context-menu";

const ACTIONS = {
  onExclude: vi.fn(),
  onOpen: vi.fn(),
  onTogglePin: vi.fn(),
};

function target(overrides: Partial<GraphNodeMenuTarget>): GraphNodeMenuTarget {
  return {
    nodeId: "/vault/My Note.md",
    isTag: false,
    isGhost: false,
    pinned: false,
    ...overrides,
  };
}

describe("buildGraphNodeMenu", () => {
  it("file node: Open / Pin / Copy wikilink / Exclude", () => {
    const labels = buildGraphNodeMenu(target({}), ACTIONS)
      .filter((i) => !i.separator)
      .map((i) => i.label);
    expect(labels).toEqual([
      "Open",
      "Pin",
      "Copy wikilink",
      "Exclude from graph",
    ]);
  });

  it("pinned node shows Unpin", () => {
    const labels = buildGraphNodeMenu(target({ pinned: true }), ACTIONS).map(
      (i) => i.label,
    );
    expect(labels).toContain("Unpin");
    expect(labels).not.toContain("Pin");
  });

  it("ghost node omits Open", () => {
    const labels = buildGraphNodeMenu(target({ isGhost: true }), ACTIONS).map(
      (i) => i.label,
    );
    expect(labels).not.toContain("Open");
    expect(labels).toContain("Exclude from graph");
  });

  it("tag node omits Open and shows Copy tag", () => {
    const labels = buildGraphNodeMenu(
      target({ isTag: true, nodeId: "tag:project" }),
      ACTIONS,
    ).map((i) => i.label);
    expect(labels).not.toContain("Open");
    expect(labels).toContain("Copy tag");
  });

  it("actions receive the node id", () => {
    const actions = {
      onExclude: vi.fn(),
      onOpen: vi.fn(),
      onTogglePin: vi.fn(),
    };
    const items = buildGraphNodeMenu(target({ pinned: true }), actions);
    items.find((i) => i.label === "Open")!.action();
    items.find((i) => i.label === "Unpin")!.action();
    items.find((i) => i.label === "Exclude from graph")!.action();
    expect(actions.onOpen).toHaveBeenCalledWith("/vault/My Note.md");
    expect(actions.onTogglePin).toHaveBeenCalledWith("/vault/My Note.md", true);
    expect(actions.onExclude).toHaveBeenCalledWith("/vault/My Note.md");
  });
});

describe("nodeClipboardText", () => {
  it("file node → wikilink without extension", () => {
    expect(nodeClipboardText(target({}))).toBe("[[My Note]]");
  });

  it("tag node → #tag", () => {
    expect(
      nodeClipboardText(target({ isTag: true, nodeId: "tag:project" })),
    ).toBe("#project");
  });

  it("ghost node → wikilink", () => {
    expect(
      nodeClipboardText(target({ isGhost: true, nodeId: "/vault/missing.md" })),
    ).toBe("[[missing]]");
  });
});
