// §394 spec 0073 D11 ② · §6 — a `data-note` click: no IPC without a context, a fixed toast on any
// refusal, and the shared opener (`openFileByPath`, plan 0125 P12) on success.
import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginNoteLink = vi.fn();
const openFileByPath = vi.fn();
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginNoteLink: (...a: unknown[]) => pluginNoteLink(...a),
}));
vi.mock("../../../utils/open-file", () => ({
  openFileByPath: (...a: unknown[]) => openFileByPath(...a),
}));

import { useUIStore } from "../../../stores/ui/ui";
import { openPluginNoteLink } from "../note-link";

beforeEach(() => {
  pluginNoteLink.mockReset();
  openFileByPath.mockReset();
  useUIStore.setState({ toast: null });
});

describe("openPluginNoteLink", () => {
  /** What fails this: asking Rust anyway — with the active context's id in place of the block's
   *  missing one (it need not be the block's, spec §5.1), or with a `null` the command cannot
   *  take. The toast is the same fixed one as every refusal's (the row below). */
  it("refuses without a context and never asks Rust", async () => {
    await expect(openPluginNoteLink(null, "a.md", "Plugin · X")).resolves.toBe(
      false,
    );
    expect(pluginNoteLink).not.toHaveBeenCalled();
    expect(useUIStore.getState().toast?.source).toBe("Plugin · X");
  });

  /** What fails this: a toast that carries the rejection — every refusal reads the same (§6). */
  it("shows the fixed toast when Rust refuses, and opens nothing", async () => {
    pluginNoteLink.mockRejectedValueOnce(
      "the link does not name a note in this vault",
    );
    await expect(
      openPluginNoteLink("ctx", "page.html", "Plugin · X"),
    ).resolves.toBe(false);
    expect(openFileByPath).not.toHaveBeenCalled();
    const refused = useUIStore.getState().toast;
    expect(refused).toMatchObject({
      message: "This link does not open a note in this vault.",
      source: "Plugin · X",
      type: "warning",
    });
    await openPluginNoteLink(null, "a.md", "Plugin · X");
    expect(useUIStore.getState().toast?.message).toBe(refused?.message);
  });

  /** The positive pair: the resolved path goes to the shared opener. */
  it("opens the path Rust resolved", async () => {
    pluginNoteLink.mockResolvedValueOnce("/v/notes/a.md");
    openFileByPath.mockResolvedValueOnce("opened");
    await expect(
      openPluginNoteLink("ctx", "notes/a.md", "Plugin · X"),
    ).resolves.toBe(true);
    expect(pluginNoteLink).toHaveBeenCalledWith("ctx", "notes/a.md");
    expect(openFileByPath).toHaveBeenCalledWith("/v/notes/a.md");
    expect(useUIStore.getState().toast).toBeNull();
  });

  /** A refused context switch has told the user why (`openFileByPath`), and a failed open is
   *  not the link's fault: neither shows the link's toast. */
  it("reports false and no toast when the open is refused or fails", async () => {
    pluginNoteLink.mockResolvedValue("/v/notes/a.md");
    openFileByPath.mockResolvedValueOnce("refused");
    await expect(
      openPluginNoteLink("ctx", "notes/a.md", "Plugin · X"),
    ).resolves.toBe(false);
    openFileByPath.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      openPluginNoteLink("ctx", "notes/a.md", "Plugin · X"),
    ).resolves.toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
