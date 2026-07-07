// Regression test: openFileInTab must seed the self-write mtime baseline so
// the creation/open echo from the file watcher isn't mistaken for an
// external change (see use-file-watcher.ts self-write guard).
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { listDir, readFile } = vi.hoisted(() => ({
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../ipc/invoke", () => ({
  listDir,
  readFile,
  createDir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { openFileInTab } from "../journal-file-service";

describe("openFileInTab", () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  });

  it("seeds the self-write baseline (lastSaveMtime) for a newly opened file", async () => {
    const filePath = "/vault/notes/202601010000 X.md";
    await openFileInTab(filePath, "# X");

    const mtimeEntry = useFileStore.getState().getFileMtime(filePath);
    expect(mtimeEntry?.lastSaveMtime).toBeGreaterThan(0);
  });
});
