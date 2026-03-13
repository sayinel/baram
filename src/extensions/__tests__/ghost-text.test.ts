// §43 Ghost Text — Unit tests for plugin key, prompt builder, and privacy integration
import { describe, expect, test } from "vitest";

import { isLLMAllowed } from "../../utils/privacy-check";
import { ghostTextPluginKey } from "../plugins/ghost-text";

describe("§43 Ghost Text — plugin key", () => {
  test("ghostTextPluginKey is defined and named correctly", () => {
    expect(ghostTextPluginKey).toBeDefined();
    // PluginKey.key is private in TS types; cast to access for testing
    expect((ghostTextPluginKey as unknown as { key: string }).key).toContain(
      "ghostText",
    );
  });
});

describe("§43 Ghost Text — privacy check integration", () => {
  test("isLLMAllowed blocks non-ollama in privacy mode", () => {
    expect(isLLMAllowed(true, "claude")).toBe(false);
    expect(isLLMAllowed(true, "openai")).toBe(false);
    expect(isLLMAllowed(true, "ollama")).toBe(true);
    expect(isLLMAllowed(false, "claude")).toBe(true);
    expect(isLLMAllowed(false, "openai")).toBe(true);
    expect(isLLMAllowed(false, "ollama")).toBe(true);
  });
});
