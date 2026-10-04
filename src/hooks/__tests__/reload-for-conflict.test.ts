// §312/§3.6 `reloadForConflict` is where the conflict modal's "Reload External Changes"
// consent is spent — on the conflicted tab only.
//
// ‼️ This test asserts the outcome, not the wiring. It reproduces the exact shape of the bug
// this guards against (a dirty tab whose source buffer diverged from the last known-disk
// content — the modal only ever shows for a dirty tab) and asserts that after the reload,
// the buffer really holds the disk text. If the consent stops reaching the buffer, the
// buffer keeps the discarded local edit and this goes red.
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { reloadForConflict } from "../../services/conflict-reload";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";

const PATH = "/v/a.md";
const TAB = "t1";

/** Last content known to match disk — the baseline the divergence gate compares against. */
const ON_DISK_BEFORE = "- [ ] alpha\n";
/** What the user typed and then chose to discard by clicking Reload. */
const LOCAL_EDIT_TO_DISCARD = "- [ ] alpha\n\n버리기로 한 로컬 편집\n";
/** What the external process wrote — Reload should make the buffer show this. */
const EXTERNAL = "- [x] alpha (외부에서 바뀐 뒤)\n";

const buffers = new Map<string, string>();

const tab = (id: string, filePath: string, isDirty: boolean): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: id,
});

beforeEach(() => {
  buffers.clear();
  buffers.set(TAB, LOCAL_EDIT_TO_DISCARD);
  readFile.mockClear();
  readFile.mockResolvedValue(EXTERNAL);

  useFileStore.setState({ openFiles: new Map([[PATH, ON_DISK_BEFORE]]) });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      hasSourceBuffer: (id) => buffers.has(id),
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceModeTabs: [TAB],
    // The conflict modal only ever shows for a dirty tab — that's precisely the
    // case where the divergence gate would otherwise skip this buffer.
    tabs: [tab(TAB, PATH, true)],
  });
});

describe("reloadForConflict", () => {
  it("overwrites the diverged, dirty source buffer with disk content", async () => {
    useUIStore.setState({ conflictQueue: [] });
    useUIStore.getState().enqueueConflict({
      base: ON_DISK_BEFORE,
      externalMtime: 999,
      filePath: PATH,
      tabId: TAB,
    });
    const entry = useUIStore.getState().conflictQueue[0];

    expect((await reloadForConflict(entry)).code).toBe("reloaded");
    expect(buffers.get(TAB)).toBe(EXTERNAL);
  });
});
