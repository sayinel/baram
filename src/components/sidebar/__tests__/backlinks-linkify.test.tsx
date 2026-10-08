// §34 · §390 — the backlinks panel's "Link" button, through the real component:
// which strings reach `linkifyMention` and what `handleLinkify` writes back.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `getConfig` · `setConfig` · `removeConfig` are the persisted stores' storage,
// read when the stores below are imported — before any `beforeEach` runs.
const ipc = vi.hoisted(() => ({
  getBacklinks: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  getUnlinkedMentions: vi.fn(),
  readFile: vi.fn(),
  refreshIndex: vi.fn(),
  removeConfig: vi.fn().mockResolvedValue(undefined),
  setConfig: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ipc);

import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { Backlinks } from "../Backlinks";

const NOTE = "노트";
const NOTE_NFD = NOTE.normalize("NFD");

describe("§390 Backlinks handleLinkify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.getBacklinks.mockResolvedValue([]);
    ipc.refreshIndex.mockResolvedValue(undefined);
    // Rust's `write_file` announces the write (`index:changed`), which the link-index
    // watcher turns into this bump (#824).
    ipc.writeFile.mockImplementation(async (path: string) => {
      useLinkStore.getState().invalidate(path);
      return 1;
    });
    useLinkStore.getState().clear();
    useFileStore.setState({ rootPath: "/r" });
    useEditorStore.setState({
      tabs: [
        {
          id: "t1",
          filePath: `/r/Baram${NOTE_NFD}.md`,
          title: `Baram${NOTE_NFD}.md`,
          isDirty: false,
          isPinned: false,
          contextId: "",
        },
      ],
      activeTabId: "t1",
    });
  });

  it("links the open note, by its composed name, over the mention it was reported with", async () => {
    // The file name is stored decomposed and the mention is in another case:
    // the link takes the name from the open tab's path, composed, and keeps
    // the mention's own text as the alias. What fails this, in Backlinks.tsx:
    // handing `linkifyMention` the mention as the name (`[[baram노트]]`), the
    // name where the mention goes (no write at all — the line holds no such
    // text), or indexing the lines by `mention.line` rather than
    // `mention.line - 1` (no write — that line holds no mention).
    expect(NOTE_NFD).not.toBe(NOTE);
    ipc.getUnlinkedMentions.mockResolvedValue([
      {
        sourcePath: "/r/src.md",
        line: 2,
        context: `about baram${NOTE}`,
        matchText: `baram${NOTE}`,
      },
    ]);
    ipc.readFile.mockResolvedValue(`first\nabout baram${NOTE} today\nlast`);

    render(<Backlinks />);
    const link = await screen.findByRole("button", { name: "Link" });
    const fetched = ipc.getUnlinkedMentions.mock.calls.length;
    fireEvent.click(link);

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.writeFile).toHaveBeenCalledWith(
      "/r/src.md",
      `first\nabout [[Baram${NOTE}|baram${NOTE}]] today\nlast`,
    );
    // The index update and the refetch it triggers settle inside the test.
    await waitFor(() =>
      expect(ipc.getUnlinkedMentions.mock.calls.length).toBeGreaterThan(
        fetched,
      ),
    );
  });
});
