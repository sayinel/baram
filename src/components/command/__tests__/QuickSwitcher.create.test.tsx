// §35 — the create row hands the typed name over in a field. Its label used to be
// re-parsed with /\+ Create "(.+)"/ to get the name back, which a translated label breaks.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickSwitcher } from "../QuickSwitcher";

beforeEach(() => {
  useUIStore.setState({ quickSwitcherOpen: true });
  useFileStore.setState({ fileTree: [], rootPath: "/v" });
  useSettingsStore.setState({ locale: "ko" });
});

function type(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

describe("QuickSwitcher — create row (§35)", () => {
  it("creates the typed name from a translated row", () => {
    // 무엇이 이것을 실패시키는가: executeResult 가 다시 라벨을 정규식으로 읽으면,
    // 한국어 라벨 `"새 노트" 만들기` 에서 이름을 찾지 못해 undefined 로 부른다.
    const onNewFile = vi.fn();
    render(<QuickSwitcher editor={null} onNewFile={onNewFile} />);
    type("새 노트");
    fireEvent.click(screen.getByText('"새 노트" 만들기'));
    expect(onNewFile).toHaveBeenCalledWith("새 노트");
  });

  it("draws the create row's + as an icon, not in its label", () => {
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type("새 노트");
    const label = screen.getByText('"새 노트" 만들기');
    expect(label.textContent).not.toContain("+");
    expect(
      label.closest(".quick-switcher-item")?.querySelector("svg.lucide"),
    ).not.toBeNull();
  });
});
