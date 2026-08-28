// §298 review D5 — the /video slash action was missing two contracts its
// sibling /image and /link items already carry: a §12-9b mutation task
// guarding the dialog's async gap, and vim external-edit tagging on the
// insert chain (design §5b). Pin both with a REAL Editor + REAL mutation-tasks
// module — mocking either would hide the exact defect these tests exist for.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "..";
import {
  countLiveEditorMutationTasks,
  invalidateEditorMutationTasks,
} from "../../utils/editor/mutation-tasks";
import { buildSlashItems } from "../plugins/slash-command-items";
import { isVimExternalEdit } from "../plugins/vim/vim-keys";

vi.mock("../../utils/field-dialog", () => ({
  showFieldDialog: vi.fn(),
}));

import { showFieldDialog } from "../../utils/field-dialog";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Give queued microtasks (the awaited dialog continuation) a chance to run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const editors: Editor[] = [];
function makeEditor(content = "<p>doc</p>"): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.clearAllMocks();
});

describe("§298 /video slash action — §12-9b mutation task guard", () => {
  it("CONTROL: an uninterrupted dialog inserts the video", async () => {
    const editor = makeEditor();
    const gate = deferred<null | Record<string, string>>();
    vi.mocked(showFieldDialog).mockReturnValueOnce(gate.promise);

    const item = buildSlashItems(editor).find((i) => i.id === "video");
    const running = item!.action();
    await flush();
    gate.resolve({ alt: "", src: "clip.mp4" });
    await running;

    expect(editor.state.doc.toString()).toContain("video");
  });

  it("a state install while the dialog is open drops the insert", async () => {
    const editor = makeEditor();
    const before = editor.state.doc.toString();
    const gate = deferred<null | Record<string, string>>();
    vi.mocked(showFieldDialog).mockReturnValueOnce(gate.promise);

    const item = buildSlashItems(editor).find((i) => i.id === "video");
    const running = item!.action();
    await flush(); // parked inside the dialog await

    // What replaceEditorStateWithVim does synchronously before installing a
    // new tab's state.
    invalidateEditorMutationTasks(editor.view);

    gate.resolve({ alt: "", src: "clip.mp4" });
    await running;

    // Without a mutation task guarding this gap, the resolved dialog value
    // still inserts into whatever document is now installed.
    expect(editor.state.doc.toString()).toBe(before);
    expect(editor.state.doc.toString()).not.toContain("video");
  });
});

describe("§298 /video slash action — vim external-edit tagging (design §5b)", () => {
  it("tags the insert transaction so vim's explicit-command matrix applies", async () => {
    const editor = makeEditor();
    vi.mocked(showFieldDialog).mockResolvedValueOnce({
      alt: "",
      src: "clip.mp4",
    });

    let tagged = false;
    editor.on("transaction", ({ transaction }) => {
      if (isVimExternalEdit(transaction)) tagged = true;
    });

    const item = buildSlashItems(editor).find((i) => i.id === "video");
    await item!.action();

    // A plain `editor.chain()` (untagged) leaves apply() on the §5b priority
    // 3 fallback instead of the priority 2 explicit-command matrix.
    expect(tagged).toBe(true);
  });
});

describe("§298 Codex TS review — dialog rejection must not leak a mutation task", () => {
  // The /image, /video and /link items each registered their §12-9b task
  // manually (register → await dialog → isLive() → finish()). When the
  // dialog promise rejects, control never reaches isLive()/finish(), so the
  // task stayed in the view's live registry forever. awaitBoundToEditor
  // fixes this with a finally-guaranteed finish().
  it.each(["image", "video", "link"] as const)(
    "the /%s item finishes its task even when the dialog promise rejects",
    async (id) => {
      const editor = makeEditor();
      const before = countLiveEditorMutationTasks(editor.view);
      vi.mocked(showFieldDialog).mockRejectedValueOnce(
        new Error("dialog boom"),
      );

      const item = buildSlashItems(editor).find((i) => i.id === id);
      await expect(item!.action()).rejects.toThrow("dialog boom");

      expect(countLiveEditorMutationTasks(editor.view)).toBe(before);
    },
  );
});
