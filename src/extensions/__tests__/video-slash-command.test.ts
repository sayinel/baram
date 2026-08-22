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
});
