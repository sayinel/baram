import { describe, expect, it } from "vitest";

import { resolveSettings } from "../settings-resolve";

describe("§86 resolveSettings", () => {
  it("returns global settings when no vault config", () => {
    const result = resolveSettings({ aiModel: "claude-sonnet" }, null);
    expect(result.aiModel).toBe("claude-sonnet");
  });

  it("returns global settings when vault config is undefined", () => {
    const result = resolveSettings(
      { aiModel: "claude-sonnet", privacyMode: false },
      undefined,
    );
    expect(result.aiModel).toBe("claude-sonnet");
    expect(result.aiPrivacyMode).toBe(false);
  });

  it("vault config overrides global", () => {
    const result = resolveSettings(
      { aiModel: "claude-sonnet" },
      { ai: { model: "claude-haiku" } },
    );
    expect(result.aiModel).toBe("claude-haiku");
  });

  it("vault config does not override when field is undefined", () => {
    const result = resolveSettings(
      { aiModel: "claude-sonnet", enableWikilink: true },
      { ai: {} },
    );
    expect(result.aiModel).toBe("claude-sonnet");
    expect(result.enableWikilink).toBe(true);
  });

  it("merges multiple sections", () => {
    const result = resolveSettings(
      { aiModel: "claude-sonnet", enableMermaid: true },
      {
        ai: { model: "claude-haiku", privacyMode: true },
        markdown: { enableMermaid: false },
        editor: { skillsFolder: "prompts" },
      },
    );
    expect(result.aiModel).toBe("claude-haiku");
    expect(result.aiPrivacyMode).toBe(true);
    expect(result.enableMermaid).toBe(false);
    expect(result.skillsFolder).toBe("prompts");
  });

  it("handles appearance theme override", () => {
    const result = resolveSettings({}, { appearance: { theme: "sepia" } });
    expect(result.themeOverride).toBe("sepia");
  });

  it("handles extensions override", () => {
    const result = resolveSettings(
      {},
      { extensions: { enabled: ["ext-wikilink"], disabled: ["ext-journal"] } },
    );
    expect(result.extensionsEnabled).toEqual(["ext-wikilink"]);
    expect(result.extensionsDisabled).toEqual(["ext-journal"]);
  });

  it("handles git overrides", () => {
    const result = resolveSettings(
      {},
      { git: { autoFetchInterval: 300, autoPushOnCommit: true } },
    );
    expect(result.gitAutoFetchInterval).toBe(300);
    expect(result.gitAutoPushOnCommit).toBe(true);
  });

  it("handles snapshot overrides", () => {
    const result = resolveSettings(
      {},
      { snapshot: { intervalMinutes: 10, maxCount: 50 } },
    );
    expect(result.snapshotIntervalMinutes).toBe(10);
    expect(result.snapshotMaxCount).toBe(50);
  });

  it("handles editor overrides", () => {
    const result = resolveSettings(
      { dailyNotesFolder: "daily", skillsFolder: "skills" },
      {
        editor: {
          dailyNotesFolder: "journal/daily",
          defaultNewFileLocation: "inbox",
        },
      },
    );
    expect(result.dailyNotesFolder).toBe("journal/daily");
    expect(result.skillsFolder).toBe("skills"); // not overridden
    expect(result.defaultNewFileLocation).toBe("inbox");
  });

  it("handles markdown serialization rules override", () => {
    const result = resolveSettings(
      {},
      { markdown: { serializationRules: { bullet: "-" } } },
    );
    expect(result.markdownSerializationRules).toEqual({ bullet: "-" });
  });

  it("handles AI context scope override", () => {
    const result = resolveSettings({}, { ai: { contextScope: "vault-only" } });
    expect(result.aiContextScope).toBe("vault-only");
  });
});
