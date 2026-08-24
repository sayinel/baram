// §297 /video 슬래시 커맨드 — /image 항목과 같은 형태(필드 dialog → insertContent)
import { describe, expect, test, vi } from "vitest";

// Minimal mock editor for buildSlashItems (mirrors ai-slash-commands.test.ts)
function createMockEditor() {
  const chainObj: Record<string, unknown> = {};
  chainObj.focus = () => chainObj;
  chainObj.insertContent = vi.fn(() => chainObj);
  chainObj.run = () => true;

  return {
    chain: () => chainObj,
    commands: {},
    state: {
      selection: { from: 0, to: 0, $from: { parent: { textContent: "" } } },
      doc: { textBetween: () => "", textContent: "" },
    },
  } as never;
}

import { showFieldDialog } from "../../utils/field-dialog";
import { buildSlashItems } from "../plugins/slash-command-items";

// §298 vim wiring: the slash action routes through chainWithVimExternalEdit
// (tagged chrome) and a §12-9b mutation task — pass both straight through so
// this test keeps observing the insertContent shape it exists for.
vi.mock("../plugins/vim/vim-keys", () => ({
  chainWithVimExternalEdit: (editor: { chain: () => unknown }) =>
    editor.chain(),
}));
vi.mock("../../utils/editor/mutation-tasks", () => ({
  registerEditorMutationTask: () => ({
    finish: () => {},
    isLive: () => true,
  }),
}));

vi.mock("../../utils/field-dialog", () => ({
  showFieldDialog: vi.fn(),
}));

describe("§297 /video slash command", () => {
  test("is registered with the Media category and an insert action", () => {
    const items = buildSlashItems(createMockEditor());
    const video = items.find((i) => i.id === "video");
    expect(video).toBeDefined();
    expect(video!.category).toBe("Media");
    expect(typeof video!.action).toBe("function");
  });

  test("does nothing when the dialog is cancelled (no src)", async () => {
    vi.mocked(showFieldDialog).mockResolvedValueOnce(null);
    const editor = createMockEditor() as unknown as {
      chain: () => { insertContent: ReturnType<typeof vi.fn> };
    };
    const items = buildSlashItems(editor as never);
    await items.find((i) => i.id === "video")!.action();
    expect(editor.chain().insertContent).not.toHaveBeenCalled();
  });

  test("inserts a video node with the dialog's src and caption", async () => {
    vi.mocked(showFieldDialog).mockResolvedValueOnce({
      src: "clip.mp4",
      alt: "My caption",
    });
    const editor = createMockEditor() as unknown as {
      chain: () => { insertContent: ReturnType<typeof vi.fn> };
    };
    const items = buildSlashItems(editor as never);
    await items.find((i) => i.id === "video")!.action();
    expect(editor.chain().insertContent).toHaveBeenCalledWith({
      type: "video",
      attrs: { src: "clip.mp4", alt: "My caption", title: "" },
    });
  });

  // §297 fix (I-4): the dialog used to insert unconditionally as `video`,
  // regardless of what the user actually typed. classifyMediaSrc reclassifies
  // an unrecognized/image src as `image` on the very next save/reload
  // (md-to-pm.ts asks the same classifier), so the live document and the
  // reloaded one would silently disagree about this node's type.
  test("inserts an IMAGE node when the Video dialog's src classifies as an image", async () => {
    vi.mocked(showFieldDialog).mockResolvedValueOnce({
      src: "photo.png",
      alt: "",
    });
    const editor = createMockEditor() as unknown as {
      chain: () => { insertContent: ReturnType<typeof vi.fn> };
    };
    const items = buildSlashItems(editor as never);
    await items.find((i) => i.id === "video")!.action();
    expect(editor.chain().insertContent).toHaveBeenCalledWith({
      type: "image",
      attrs: { src: "photo.png", alt: "", title: "" },
    });
  });
});

describe("§297 /image slash command routes through the classifier too (I-4)", () => {
  test("inserts a VIDEO node when the Image dialog's src classifies as a video", async () => {
    vi.mocked(showFieldDialog).mockResolvedValueOnce({
      src: "clip.mp4",
      alt: "",
    });
    const editor = createMockEditor() as unknown as {
      chain: () => { insertContent: ReturnType<typeof vi.fn> };
    };
    const items = buildSlashItems(editor as never);
    await items.find((i) => i.id === "image")!.action();
    expect(editor.chain().insertContent).toHaveBeenCalledWith({
      type: "video",
      attrs: { src: "clip.mp4", alt: "", title: "" },
    });
  });

  test("keeps inserting an image node for an actual image src", async () => {
    vi.mocked(showFieldDialog).mockResolvedValueOnce({
      src: "photo.png",
      alt: "A photo",
    });
    const editor = createMockEditor() as unknown as {
      chain: () => { insertContent: ReturnType<typeof vi.fn> };
    };
    const items = buildSlashItems(editor as never);
    await items.find((i) => i.id === "image")!.action();
    expect(editor.chain().insertContent).toHaveBeenCalledWith({
      type: "image",
      attrs: { src: "photo.png", alt: "A photo", title: "" },
    });
  });
});
