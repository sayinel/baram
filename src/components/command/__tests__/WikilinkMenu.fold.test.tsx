// §390 — two rows whose labels differ only in Unicode normalization look the
// same on screen, so they get the folder hint, as rows equal but for case do.
import type { WikilinkSuggestionItem } from "../../../extensions/plugins/wikilink-suggest-utils";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WikilinkMenuList } from "../WikilinkMenu";

const NOTE = "노트";
const NOTE_NFD = NOTE.normalize("NFD");

/**
 * Built by hand on purpose: `buildFileSuggestionItem` composes its labels
 * (§390 D7), and this test is about a menu handed both spellings.
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
