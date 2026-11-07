// §395 spec 0074 D16 · §7 "계획 B" (메뉴) — how the tree's menu draws plugin items: after a separator at the
// foot of both the single and the multi branch, each with its plugin's name; a disabled one dimmed with its
// reason; a runnable one closing the menu before it runs; none on the empty area's menu.
import type { FileTreePluginItem } from "../file-tree-plugin-menu";
import type { ContextMenuState } from "../file-tree-types";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileTreeContextMenu } from "../file-tree-context-menu";

const fileRow: ContextMenuState = {
  pluginItems: [],
  selectionCount: 1,
  selectionHasDir: false,
  targetIsDir: false,
  targetPath: "/r/a.md",
  x: 0,
  y: 0,
};
const items = (run: () => void = vi.fn()): FileTreePluginItem[] => [
  { detail: "Pins", key: "pins:pin", label: "Pin", run },
  {
    detail: "Bulk",
    disabledReason: "Not available for more than 1,000 items",
    key: "bulk:go",
    label: "Go",
  },
];
/** The menu's rows in order: a separator as "—", any other row as its text. */
const rows = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".file-tree-context-menu > *")].map((el) =>
    el.classList.contains("file-tree-context-menu-separator")
      ? "—"
      : (el.textContent ?? ""),
  );
const draw = (menu: ContextMenuState, onClose: () => void = vi.fn()) =>
  render(
    <FileTreeContextMenu menu={menu} onAction={vi.fn()} onClose={onClose} />,
  ).container;
const itemOf = (text: string) =>
  screen.getByText(text).closest<HTMLElement>(".file-tree-context-menu-item")!;

describe("FileTreeContextMenu — plugin items (§395 D16)", () => {
  /** What fails this: the group drawn in one branch only — the menu has two (§312 hit the same split). */
  it.each([
    ["a file row", fileRow, "Version History"],
    ["a selection", { ...fileRow, selectionCount: 3 }, "Copy Path"],
  ])("draws them after a separator at the foot of %s", (_, menu, last) => {
    expect(rows(draw({ ...menu, pluginItems: items() })).slice(-4)).toEqual([
      last,
      "—",
      "Pin Pins",
      "Go Bulk",
    ]);
  });

  it("draws no separator when there is no plugin item", () => {
    expect(rows(draw(fileRow)).at(-1)).toBe("Version History");
  });

  /** What fails this: the group placed outside the row branches — the empty area's menu would show it. */
  it("draws none on the empty area's menu", () => {
    expect(
      rows(draw({ ...fileRow, pluginItems: items(), targetPath: null })),
    ).toEqual(["New File", "New Folder"]);
  });

  /** What fails this: an item that runs without closing — the menu stops its own clicks, so nothing else closes it. */
  it("closes the menu, then runs, on a click", () => {
    const order: string[] = [];
    draw({ ...fileRow, pluginItems: items(() => order.push("run")) }, () =>
      order.push("close"),
    );
    fireEvent.click(screen.getByText("Pin"));
    expect(order).toEqual(["close", "run"]);
  });

  it("draws a disabled item dimmed, with its reason, and a click does nothing", () => {
    const onClose = vi.fn();
    draw({ ...fileRow, pluginItems: items() }, onClose);
    const go = itemOf("Go");
    expect(go.getAttribute("title")).toBe(
      "Not available for more than 1,000 items",
    );
    expect(go.getAttribute("aria-disabled")).toBe("true");
    expect(go.className).toContain("file-tree-context-menu-item-disabled");
    fireEvent.click(go);
    expect(onClose).not.toHaveBeenCalled();
    expect(itemOf("Pin").getAttribute("aria-disabled")).toBeNull();
  });
});
