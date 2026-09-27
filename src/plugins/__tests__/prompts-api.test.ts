// §385 spec 0061 §4, §5.3–§5.4 — refusal order, sanitising, and what ends a flow.
import { afterEach, describe, expect, it, vi } from "vitest";

const { show } = vi.hoisted(() => ({
  show: vi.fn(),
}));
vi.mock("../../components/plugins/show-plugin-prompt", () => ({
  showPluginPrompt: (...args: unknown[]) => show(...args),
}));

import {
  beginPluginInvocation,
  PromptOccludedError,
  promptRefusal,
  resetPromptGate,
} from "../prompt-gate";
import { createPromptsAPI } from "../prompts-api";

const api = createPromptsAPI("p", "My Plugin");
afterEach(() => {
  resetPromptGate();
  show.mockReset();
});

describe("createPromptsAPI", () => {
  it("refuses outside a command without drawing anything", async () => {
    await expect(api.showInputBox()).rejects.toThrow(
      /prompt refused: .*commands is running/,
    );
    expect(show).not.toHaveBeenCalled();
  });

  it("checks the gate before the limits — a refused plugin costs no walk over its items", async () => {
    await expect(api.showQuickPick([])).rejects.toThrow(/commands is running/);
    beginPluginInvocation("p");
    await expect(api.showQuickPick([])).rejects.toThrow(/must not be empty/);
    expect(show).not.toHaveBeenCalled();
  });

  it("hands the window sanitised text and the id untouched", async () => {
    beginPluginInvocation("p");
    show.mockResolvedValueOnce("\u202Eid");
    await api.showQuickPick(
      [{ description: "d\u202E", id: "\u202Eid", label: "x".repeat(250) }],
      { title: "t\n" },
    );
    const [pluginId, source, spec] = show.mock.calls[0];
    expect([pluginId, source]).toEqual(["p", "My Plugin"]);
    expect(spec.items[0].id).toBe("\u202Eid");
    expect(spec.items[0].description).toBe("d");
    expect(spec.items[0].label).toHaveLength(200);
    expect(spec.title).toBe("t");
  });

  it("ends the flow on a cancel, and a new command restores it", async () => {
    beginPluginInvocation("p");
    show.mockResolvedValueOnce(undefined);
    await expect(api.showInputBox()).resolves.toBeUndefined();
    await expect(api.showInputBox()).rejects.toThrow(/cancelled a prompt/);
    beginPluginInvocation("p");
    show.mockResolvedValueOnce("ok");
    await expect(api.showInputBox()).resolves.toBe("ok");
  });

  it("keeps the flow after a pick", async () => {
    beginPluginInvocation("p");
    show.mockResolvedValueOnce("a");
    await api.showQuickPick([{ id: "a", label: "A" }]);
    expect(promptRefusal("p")).toBeNull();
  });

  it("ends the flow on an occlusion refusal", async () => {
    beginPluginInvocation("p");
    show.mockRejectedValueOnce(new PromptOccludedError());
    await expect(api.showInputBox()).rejects.toBeInstanceOf(
      PromptOccludedError,
    );
    expect(promptRefusal("p")).toMatch(/cancelled a prompt/);
  });
});
