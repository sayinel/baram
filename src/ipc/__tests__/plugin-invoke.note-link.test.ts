import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { pluginNoteLink } from "../plugin-invoke";

// §394 — the one place the note-link command's name and argument keys are executed. Tauri binds
// `context` and `path` by name (`plugin_note_link_cmd.rs`); a typo here typechecks and every
// `data-note` click is refused. What fails this: renaming the command or reshaping the args.
describe("pluginNoteLink", () => {
  it("sends plugin_note_link with { context, path } and resolves with the path to open", async () => {
    invoke.mockResolvedValueOnce("/v/notes/a.md");
    await expect(pluginNoteLink("ctx-1", "notes/a.md")).resolves.toBe(
      "/v/notes/a.md",
    );
    expect(invoke).toHaveBeenLastCalledWith("plugin_note_link", {
      context: "ctx-1",
      path: "notes/a.md",
    });
  });
});
