import type { BacklinkEntry } from "../../ipc/types";

// §29 백링크 패널 통합 테스트
// Tests the backlink data flow: IPC response → linkStore → grouping logic
import { beforeEach, describe, expect, it } from "vitest";

import {
  extractFileNameFromPath,
  groupBacklinksByFile,
} from "../../components/sidebar/backlink-utils";
import { useLinkStore } from "../../stores/link-store";

describe("Backlink panel integration", () => {
  beforeEach(() => {
    useLinkStore.getState().clear();
  });

  // --- groupBacklinksByFile ---

  it("groups backlinks by source file", () => {
    const entries: BacklinkEntry[] = [
      {
        sourcePath: "/docs/a.md",
        targetPath: "/docs/target.md",
        context: "See [[target]]",
        line: 3,
      },
      {
        sourcePath: "/docs/b.md",
        targetPath: "/docs/target.md",
        context: "Also [[target]]",
        line: 7,
      },
      {
        sourcePath: "/docs/a.md",
        targetPath: "/docs/target.md",
        context: "Another [[target]] ref",
        line: 15,
      },
    ];

    const grouped = groupBacklinksByFile(entries);
    expect(grouped).toHaveLength(2);

    const groupA = grouped.find((g) => g.sourcePath === "/docs/a.md");
    expect(groupA).toBeDefined();
    expect(groupA!.entries).toHaveLength(2);

    const groupB = grouped.find((g) => g.sourcePath === "/docs/b.md");
    expect(groupB).toBeDefined();
    expect(groupB!.entries).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(groupBacklinksByFile([])).toEqual([]);
  });

  it("preserves entry order within each group", () => {
    const entries: BacklinkEntry[] = [
      { sourcePath: "/a.md", targetPath: "/t.md", context: "first", line: 1 },
      { sourcePath: "/a.md", targetPath: "/t.md", context: "second", line: 10 },
      { sourcePath: "/a.md", targetPath: "/t.md", context: "third", line: 20 },
    ];

    const grouped = groupBacklinksByFile(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].entries.map((e) => e.context)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  // --- extractFileNameFromPath ---

  it("extracts file name from path", () => {
    expect(extractFileNameFromPath("/docs/notes/architecture.md")).toBe(
      "architecture.md",
    );
    expect(extractFileNameFromPath("/single.md")).toBe("single.md");
    expect(extractFileNameFromPath("relative.md")).toBe("relative.md");
  });

  // --- Store ↔ grouping integration ---

  it("store data can be grouped for display", () => {
    useLinkStore.getState().setBacklinks("/docs/target.md", [
      {
        sourcePath: "/docs/overview.md",
        targetPath: "/docs/target.md",
        context: "[[target]] is key",
        line: 5,
      },
      {
        sourcePath: "/docs/roadmap.md",
        targetPath: "/docs/target.md",
        context: "planned in [[target]]",
        line: 12,
      },
      {
        sourcePath: "/docs/overview.md",
        targetPath: "/docs/target.md",
        context: "see also [[target#intro]]",
        line: 22,
      },
    ]);

    const { backlinks } = useLinkStore.getState();
    const grouped = groupBacklinksByFile(backlinks);

    expect(grouped).toHaveLength(2);
    // overview.md has 2 entries
    const overview = grouped.find((g) => g.sourcePath.includes("overview"));
    expect(overview!.entries).toHaveLength(2);
  });
});
