// §390 spec 0069 §5 — fuzzyScore folds its two strings on every call, so a
// sort whose comparator scores folds twice per comparison: over 10,000 names
// that put Quick Switcher past the 16 ms keystroke budget (plan 0120, measured
// 2026-10-06). Each candidate is scored once, then sorted. Pinned by count,
// not time (CLAUDE.md "성능 회귀 테스트는 카운트로").
import type { FileEntry } from "../../../stores/file/file";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fuzzyScore } = vi.hoisted(() => ({ fuzzyScore: vi.fn() }));

vi.mock("../../../utils/file-search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../utils/file-search")>();
  fuzzyScore.mockImplementation(actual.fuzzyScore);
  return { ...actual, fuzzyScore };
});

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickSwitcher } from "../QuickSwitcher";

const COUNT = 200;

/**
 * Names whose scores rise and fall in a cycle of seven (the gap before
 * `note` grows), so no long stretch of the list is already in score order — on a
 * sorted run the engine's sort compares about once per element, and a
 * comparator that scores would hide inside that.
 */
function names(): FileEntry[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const name = `${"x".repeat(i % 7)}note-${i}.md`;
    return { isDir: false, name, path: `/v/${name}` } as FileEntry;
  });
}

beforeEach(() => {
  useUIStore.setState({ quickSwitcherOpen: true });
  useSettingsStore.setState({ locale: "ko" });
  useFileStore.setState({ fileTree: names(), rootPath: "/v" });
});

describe("§390 Quick Switcher scores each candidate once per list", () => {
  it("in the file list", () => {
    // What fails this: `results` sorting with a comparator that calls
    // fuzzyScore — two calls per comparison, about n·log2(n) comparisons.
    // A keystroke builds the list twice — the heading effect sets two empty
    // arrays, which changes `activeHeadings` — so the bound is two lists' worth.
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    fuzzyScore.mockClear();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "note" },
    });
    expect(fuzzyScore.mock.calls.length).toBeGreaterThanOrEqual(COUNT);
    expect(fuzzyScore.mock.calls.length).toBeLessThanOrEqual(2 * COUNT);
  });

  it("in the file#heading lookup", () => {
    // What fails this: the lookup sorting with a comparator that calls fuzzyScore.
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    fuzzyScore.mockClear();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "note#" },
    });
    expect(fuzzyScore.mock.calls.length).toBeGreaterThanOrEqual(COUNT);
    expect(fuzzyScore.mock.calls.length).toBeLessThanOrEqual(2 * COUNT);
  });
});
