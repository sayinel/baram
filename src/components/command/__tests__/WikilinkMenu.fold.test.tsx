// §390 — two rows whose labels fold to one string look the same on screen, so
// they get the folder hint, as rows equal but for case do. The row builders
// compose their labels (D7), so a pair that differs only in normalization is a
// menu handed rows built by hand (the first case); the pair the builders can
// make differs by case plus a mark (the second).
import type { WikilinkSuggestionItem } from "../../../extensions/plugins/wikilink-suggest-utils";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { buildFileSuggestionItem } from "../../../extensions/plugins/wikilink-suggest-utils";
import { WikilinkMenuList } from "../WikilinkMenu";

const NOTE = "노트";
const NOTE_NFD = NOTE.normalize("NFD");
// Capital J with a caron has no composed form: lowercased it is `j` + caron,
// which NFC composes to U+01F0. Both labels below are composed (NFC) already.
const J_CARON = String.fromCodePoint(0x4a, 0x30c);
const J_CARON_LOWER = String.fromCodePoint(0x1f0);

/**
 * Built by hand on purpose: `buildFileSuggestionItem` composes its labels
 * (§390 D7), and the first case is about a menu handed both spellings.
 */
function fileRow(
  label: string,
  path: string,
  id: string,
): WikilinkSuggestionItem {
  return { id, label, path, target: label };
}

describe("§390 WikilinkMenuList — ambiguous rows", () => {
  it("shows the folder on two rows whose labels differ only in normalization", () => {
    // What fails this: ambiguousLabels keyed by toLowerCase.
    expect(NOTE_NFD).not.toBe(NOTE);
    render(
      <WikilinkMenuList
        command={vi.fn()}
        items={[
          fileRow(NOTE, "/v/a/x.md", "1"),
          fileRow(NOTE_NFD, "/v/b/x.md", "2"),
        ]}
      />,
    );
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
  });

  it("shows the folder on two composed rows that differ by case plus a mark", () => {
    // What fails this: ambiguousLabels keyed by toLowerCase — it lowercases the
    // capital J + caron to `j` + caron, which is not the composed U+01F0 the
    // other label spells.
    const rows = [
      buildFileSuggestionItem(
        { name: `${J_CARON}ournal.md`, path: "/v/a/x.md" },
        "1",
      ),
      buildFileSuggestionItem(
        { name: `${J_CARON_LOWER}ournal.md`, path: "/v/b/x.md" },
        "2",
      ),
    ];
    expect(rows[0].label).not.toBe(rows[1].label);
    render(<WikilinkMenuList command={vi.fn()} items={rows} />);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
  });

  it("and no folder on rows whose labels differ", () => {
    // The partner: the hint is for look-alikes only.
    render(
      <WikilinkMenuList
        command={vi.fn()}
        items={[
          fileRow(NOTE, "/v/a/x.md", "1"),
          fileRow("다른", "/v/b/y.md", "2"),
        ]}
      />,
    );
    expect(screen.queryByText("a")).toBeNull();
  });
});
