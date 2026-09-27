// §385 spec 0061 D5 — a render that throws AFTER the prompt is live (a keystroke's re-render,
// say) must not be swallowed by `onUncaughtError` reading `mountError` only once at mount: the
// slot has to free and the promise has to reject, not hang open under a dead, unresponsive
// overlay until a backdrop click finally settles it with `undefined`.
//
// ‼️ The failing update is fired with a RAW `input.dispatchEvent(...)`, not
// `@testing-library/react`'s `fireEvent`. `fireEvent` wraps its dispatch in RTL's own act
// tracking, and with an act queue active React routes an uncaught render error to that queue's
// `thrownErrors` (rethrown synchronously to whoever called `fireEvent`, purely for test
// visibility — see `react-dom-client.development.js`'s `logUncaughtError`) instead of calling
// `onUncaughtError` at all. There is no such queue in a real browser or in the SUT's own
// `flushSync` mount above, which is why that one already reaches `onUncaughtError` cleanly —
// this file has to dispatch the same way to exercise the same path production does.
import { useState } from "react";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../PluginPrompt", () => ({
  // Renders a real `.plugin-prompt-input` so the launcher's occlusion check passes and it
  // takes focus normally, then throws on the NEXT render — the failure this file is about,
  // as opposed to the mount-time failure `show-plugin-prompt.mount-failure.test.tsx` covers.
  PluginPrompt: () => {
    const [broken, setBroken] = useState(false);
    if (broken) throw new Error("late render failed");
    return (
      <input className="plugin-prompt-input" onChange={() => setBroken(true)} />
    );
  },
}));

import {
  beginPluginInvocation,
  promptRefusal,
  resetPromptGate,
} from "../../../plugins/prompt-gate";
import { logger } from "../../../utils/logger";
import { showPluginPrompt } from "../show-plugin-prompt";
import { stubPromptLayout } from "./prompt-layout";

/** The native "value" setter, bypassing React's own tracked-value interception. */
const nativeValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)!.set!;

afterEach(() => {
  resetPromptGate();
  document.body.innerHTML = "";
});

describe("a prompt whose render throws after it is live", () => {
  it("rejects, frees the slot and logs — without a second unmount", async () => {
    const restoreLayout = stubPromptLayout();
    const logError = vi.spyOn(logger, "error").mockImplementation(() => {});
    const answer = showPluginPrompt("p", "P", { kind: "inputBox" });
    const input = document.querySelector<HTMLInputElement>(
      ".plugin-prompt-input",
    )!;
    nativeValueSetter.call(input, "x");
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await expect(answer).rejects.toThrow("late render failed");
    expect(logError).toHaveBeenCalled();
    expect(document.querySelector(".plugin-prompt-overlay")).toBeNull();
    logError.mockRestore();
    restoreLayout();
    // The slot is free again, the same way the mount-failure test checks it.
    beginPluginInvocation("q");
    expect(promptRefusal("q")).toBeNull();
  });
});
