// issue 263 — a block ID rename reports the RIGHT failure.
//
// `renameBlockId(...).then(body).catch(toast)` could not tell "the backend
// refused the cross-file update" from "the backend did it and the local cache
// refresh threw". The toast says the references in other files were not
// updated, so the second case reported the opposite of what happened. The
// commit path now uses `.then(onFulfilled, onRejected)` and the success body
// owns its own errors.
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(async () => "reloaded"),
  renameBlockId: vi.fn(),
  updateFileIndex: vi.fn(async () => undefined),
}));

import type { EditorView } from "@tiptap/pm/view";

import { renameBlockId } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";
import { commitBlockIdEdit } from "../block-id-widgets";

const schema = new Schema({
  marks: {},
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      attrs: { blockId: { default: null } },
      content: "inline*",
      group: "block",
    },
    text: { group: "inline" },
  },
});

/**
 * The narrow slice of `EditorView` `commitBlockIdEdit` touches: a state to read
 * the node from, a dispatch that applies the transaction, and `focus`.
 */
function makeView(): EditorView {
  let state = EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", { blockId: "old" }, [schema.text("hello")]),
    ]),
    schema,
  });
  return {
    dispatch: (tr: ReturnType<typeof state.tr.setMeta>) => {
      state = state.apply(tr);
    },
    focus: () => {},
    get state() {
      return state;
    },
  } as unknown as EditorView;
}

/** Let the IPC promise and the `await readFile` inside its body settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

const showToast = vi.fn();
const invalidate = vi.fn();
const setFileContent = vi.fn();

beforeEach(() => {
  vi.mocked(renameBlockId).mockReset();
  // ‼️ mockReset, not mockClear — two cases install a THROWING implementation
  // and `mockClear` keeps it, so the later cases would inherit the throw and
  // pass for the wrong reason (they did, against the unfixed source).
  showToast.mockReset();
  invalidate.mockReset();
  setFileContent.mockReset();
  useUIStore.setState({ showToast });
  useLinkStore.setState({ invalidate });
  useFileStore.setState({
    openFiles: new Map([["/vault/other.md", "stale"]]),
    setFileContent,
  } as never);
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      {
        contextId: "c1",
        filePath: "/vault/note.md",
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note.md",
        type: "file",
      },
    ],
  } as never);
});

describe("commitBlockIdEdit — the toast belongs to the IPC rejection only", () => {
  it("shows the failure toast when the backend refuses the rename", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(renameBlockId).mockRejectedValue("LINK_INDEX_NOT_READY");

    commitBlockIdEdit(makeView(), 0, "fresh");
    await flush();

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain("LINK_INDEX_NOT_READY");
    expect(type).toBe("error");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("stays silent and only logs when the local cache refresh throws", async () => {
    // `invalidate` is the last statement of the success body and sits outside
    // the pre-existing inner try, so it is what a local throw looks like from
    // the new handler's point of view. The backend has already rewritten the
    // references by then — a failure toast here would be a lie.
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    invalidate.mockImplementation(() => {
      throw new Error("boom");
    });

    commitBlockIdEdit(makeView(), 0, "fresh");
    await flush();

    expect(showToast).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[blockId] refreshing renamed references failed:",
      expect.any(Error),
    );
    errors.mockRestore();
  });

  it("stays silent when writing the reloaded content throws", async () => {
    // The requested case. It never reached the outer handler even before this
    // change — `readFile` + `setFileContent` have their own "file may have been
    // deleted" catch — so this pins that swallow rather than the new one.
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });
    setFileContent.mockImplementation(() => {
      throw new Error("boom");
    });

    commitBlockIdEdit(makeView(), 0, "fresh");
    await flush();

    expect(setFileContent).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("CONTROL: a clean rename refreshes the cache and toasts nothing", async () => {
    vi.mocked(renameBlockId).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/other.md"],
    });

    commitBlockIdEdit(makeView(), 0, "fresh");
    await flush();

    expect(setFileContent).toHaveBeenCalledWith("/vault/other.md", "reloaded");
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });
});
