// §385 spec 0061 §5.5 — a render that throws must free the app-wide slot (D5), or every
// plugin's prompt is refused until reload.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../PluginPrompt", () => ({
  PluginPrompt: () => {
    throw new Error("render failed");
  },
}));

import {
  beginPluginInvocation,
  promptRefusal,
  resetPromptGate,
} from "../../../plugins/prompt-gate";
import { showPluginPrompt } from "../show-plugin-prompt";

afterEach(() => resetPromptGate());

describe("a prompt whose render throws", () => {
  it("rejects and frees the slot", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      showPluginPrompt("p", "P", { kind: "inputBox" }),
    ).rejects.toThrow("render failed");
    // With `onUncaughtError` installed, React reports the error THROUGH the handler and
    // logs nothing of its own; a call here would mean the handler fell through and React went
    // looking for a default (`window.reportError`/`console.error`) instead.
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    beginPluginInvocation("q");
    expect(promptRefusal("q")).toBeNull();
    expect(document.querySelector(".plugin-prompt-overlay")).toBeNull();
  });
});
