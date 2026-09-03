import type { TagSuggestion } from "../use-capture-tags";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { TagSuggest } from "../TagSuggest";

const LOCALE = "en";

describe("TagSuggest", () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: LOCALE });
  });

  it("renders nothing when not visible, even with suggestions", () => {
    render(
      <TagSuggest
        activeIndex={0}
        onSelect={vi.fn()}
        suggestions={[{ count: 3, isNote: false, name: "rust" }]}
        visible={false}
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("renders nothing when the suggestion list is empty", () => {
    render(
      <TagSuggest
        activeIndex={0}
        onSelect={vi.fn()}
        suggestions={[]}
        visible={true}
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  // ‼️ §324-b 후속 — this component receives the already-computed list and
  // draws it as-is. It must not re-derive an order of its own: the items
  // must appear in exactly the array order it was handed, which is what lets
  // the keyboard (indexing into the same array in `useCaptureTags`) and the
  // screen agree on what "item 0" means.
  it("renders suggestions in the exact order it was given", () => {
    const suggestions: TagSuggestion[] = [
      { count: 0, isNote: true, name: "CaptureTest" },
      { count: 40, isNote: false, name: "영감노트" },
      { count: 2, isNote: false, name: "links" },
    ];
    render(
      <TagSuggest
        activeIndex={0}
        onSelect={vi.fn()}
        suggestions={suggestions}
        visible={true}
      />,
    );
    const names = screen
      .getAllByRole("option")
      .map((el) => el.querySelector(".tag-suggest-name")?.textContent);
    expect(names).toEqual(["#CaptureTest", "#영감노트", "#links"]);
  });

  it("marks the active index as selected", () => {
    render(
      <TagSuggest
        activeIndex={1}
        onSelect={vi.fn()}
        suggestions={[
          { count: 1, isNote: false, name: "a" },
          { count: 1, isNote: false, name: "b" },
        ]}
        visible={true}
      />,
    );
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  // §324-b 후속 규칙 ③: a note's count is a *capture* count, not a file count
  // like a tag's — showing it as a bare number reads as "0 captures" noise
  // for the exact case (a freshly created note) this feature exists for.
  it("shows a plain number for a tag but a labelled kind for a note", () => {
    render(
      <TagSuggest
        activeIndex={0}
        onSelect={vi.fn()}
        suggestions={[
          { count: 12, isNote: false, name: "rust" },
          { count: 0, isNote: true, name: "CaptureTest" },
          { count: 3, isNote: true, name: "Hub" },
        ]}
        visible={true}
      />,
    );
    const options = screen.getAllByRole("option");
    // ‼️ 리뷰 MEDIUM — 텍스트만이 아니라 **클래스**를 고정한다. 노트 행이
    // `.tag-suggest-count`(짧은 숫자 하나를 가정한 pill)를 쓰면 텍스트 단정은
    // 여전히 통과하지만 그 pill 안에서 줄바꿈된다 — 실제 결함이 그 모양이었다.
    expect(
      options.map((el) => el.querySelector(".tag-suggest-count")?.textContent),
    ).toEqual(["12", undefined, undefined]);
    expect(
      options.map((el) => el.querySelector(".tag-suggest-kind")?.textContent),
    ).toEqual([undefined, "Note", "Note · Captures: 3"]);
  });
});
