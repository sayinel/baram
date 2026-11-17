// §3.6 · §35 The home screen's New File opened a tab whose title was the click event.
//
// The button hands `onNewFile` to `onClick` as it is, so React calls it with the click event.
// `handleNewFile` used to take an optional name for the quick switcher's create row, and that
// parameter received the event. The tab's title became the event object, and the quick switcher,
// which App always mounts, threw on it while listing open untitled tabs (`extractNamespace` ←
// `relativePath: t.title`). The app fell into its error boundary.
//
// This renders the two consumers App mounts together — the home surface and the quick switcher —
// around the real `useFileOperations`, and clicks the real button.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useFileOperations } from "../../../hooks/use-file-operations";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickSwitcher } from "../../command/QuickSwitcher";
import { HomeSurface } from "../HomeSurface";

const noop = () => {};
const NO_SOURCE_MODE: ReadonlySet<string> = new Set();

function Shell() {
  const { handleNewFile, handleNewNamedFile } = useFileOperations({
    editor: null,
    getSourceBuffer: () => "",
    sourceModeTabs: NO_SOURCE_MODE,
  });
  return (
    <>
      <HomeSurface
        onNewFile={handleNewFile}
        onOpenFile={noop}
        onOpenFolder={noop}
        onOpenRecentFile={noop}
        onOpenRecentFolder={noop}
      />
      <QuickSwitcher editor={null} onNewFile={handleNewNamedFile} />
    </>
  );
}

beforeEach(() => {
  useSettingsStore.setState({
    locale: "en",
    recentFiles: [],
    recentFolders: [],
  });
  useUIStore.setState({ quickSwitcherOpen: false });
  useFileStore.setState({ fileTree: [], openFiles: new Map(), rootPath: null });
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
});

describe("home screen New File (§3.6)", () => {
  // 무엇이 이것을 실패시키는가: `handleNewFile` 이 다시 인자를 받으면 클릭 이벤트가 그 인자로 들어가
  // 제목이 이벤트 객체가 되고, 같은 렌더에서 퀵 스위처가 그 제목으로 경로를 읽다가 던진다.
  it("opens a tab titled Untitled, and the next one Untitled 2", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const button = await screen.findByRole("button", { name: "New File" });

    await user.click(button);
    const first = useEditorStore.getState().tabs;
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe("Untitled");
    expect(first[0].filePath).toBe("");
    expect(useEditorStore.getState().activeTabId).toBe(first[0].id);

    // The count reads the titles already open, so a second click only works on string titles.
    await user.click(button);
    expect(useEditorStore.getState().tabs.map((t) => t.title)).toEqual([
      "Untitled",
      "Untitled 2",
    ]);
  });

  // The pair: the switcher does list untitled tabs by their title, so the row below is the
  // path that threw — not a list that skips them.
  it("lists the new tab in the quick switcher by its title", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.click(await screen.findByRole("button", { name: "New File" }));

    act(() => {
      useUIStore.setState({ quickSwitcherOpen: true });
    });
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
