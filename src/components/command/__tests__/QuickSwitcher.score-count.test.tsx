// §390 spec 0069 §5 — fuzzyScore folds its two strings on every call, so a
// sort whose comparator scores calls it twice per comparison: over 10,000
// names that put Quick Switcher past the 16 ms keystroke budget for one query
// of five (`e`: 16.06–16.79 ms; the other four 3.8–11.2 ms — minima of single
// runs, not medians. V8 in jsdom, plan 0120, measured 2026-10-06/07). Each
// candidate is scored once, then sorted.
// Pinned by count, not time — CLAUDE.md:
// "성능 회귀 테스트는 타이밍이 아니라 카운트로 고정".
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
  useFileStore.setState({
    fileTree: names(),
    openFiles: new Map(),
    rootPath: "/v",
  });
});

describe("§390 Quick Switcher scores each candidate once per list", () => {
  it("in the file list", () => {
    // What fails this: `results` sorting with a comparator that calls
    // fuzzyScore — two calls per comparison, about n·log2(n) comparisons.
    // A keystroke builds the list twice — the heading effect sets two empty
    // arrays, which changes `activeHeadings` — so the bound is two lists' worth.
    // The upper bound is 2 × COUNT with no slack, so it also pins "at most two
    // list builds per keystroke": a third rebuild (600 calls) fails it too.
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
    // Every file is open already, so the lookup reads the target's headings from
    // `openFiles` at once. Unopened, it calls `readFile`, which rejects after
    // this body has returned, and the `.catch` sets state outside act() — a
    // warning vitest prints for a passing test only under `--silent=false`.
    // `readFile` makes no fuzzyScore call, so the count is the same either way.
    useFileStore.setState({
      openFiles: new Map(names().map((f) => [f.path, "# Heading\n"])),
    });
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    fuzzyScore.mockClear();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "note#" },
    });
    expect(fuzzyScore.mock.calls.length).toBeGreaterThanOrEqual(COUNT);
    expect(fuzzyScore.mock.calls.length).toBeLessThanOrEqual(2 * COUNT);
  });
});
