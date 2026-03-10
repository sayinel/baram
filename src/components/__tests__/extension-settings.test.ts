// Extension Settings — registry schema parsing and settings store integration tests
import { beforeEach, describe, expect, it } from "vitest";

import registry from "../../extensions/registry.json";
import { useSettingsStore } from "../../stores/settings-store";

// ─── Types (mirrors ExtensionsTab.tsx) ───────────────────────────────────────

interface RegistryEntry {
  name: string;
  settings?: SettingDef[];
}

interface SettingDef {
  default: unknown;
  description: string;
  key: string;
  label: string;
  max?: number;
  min?: number;
  options?: SettingOption[];
  placeholder?: string;
  step?: number;
  type: "boolean" | "number" | "select" | "string";
}

interface SettingOption {
  label: string;
  value: string;
}

// ─── Helper (mirrors ExtensionsTab.tsx getExtensionsWithSettings) ─────────────

function formatName(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function getExtensionsWithSettings(): {
  name: string;
  settings: SettingDef[];
}[] {
  const allEntries: RegistryEntry[] = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];
  return allEntries
    .filter(
      (e): e is RegistryEntry & { settings: SettingDef[] } =>
        Array.isArray(e.settings) && e.settings.length > 0,
    )
    .map((e) => ({ name: e.name, settings: e.settings }));
}

// Reset extension settings before each test
beforeEach(() => {
  useSettingsStore.setState({ extensionSettings: {} });
});

// ─── Registry structure ───────────────────────────────────────────────────────

describe("Registry structure", () => {
  it("has nodes, marks, and plugins arrays", () => {
    expect(Array.isArray(registry.nodes)).toBe(true);
    expect(Array.isArray(registry.marks)).toBe(true);
    expect(Array.isArray(registry.plugins)).toBe(true);
  });

  it("every registry entry has a name field", () => {
    const all: RegistryEntry[] = [
      ...(registry.nodes as RegistryEntry[]),
      ...(registry.marks as RegistryEntry[]),
      ...(registry.plugins as RegistryEntry[]),
    ];
    for (const entry of all) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });
});

// ─── getExtensionsWithSettings ────────────────────────────────────────────────

describe("getExtensionsWithSettings", () => {
  it("returns only entries that have a non-empty settings array", () => {
    const result = getExtensionsWithSettings();
    for (const ext of result) {
      expect(Array.isArray(ext.settings)).toBe(true);
      expect(ext.settings.length).toBeGreaterThan(0);
    }
  });

  it("includes codeBlock extension (has settings in registry)", () => {
    const result = getExtensionsWithSettings();
    const names = result.map((e) => e.name);
    expect(names).toContain("codeBlock");
  });

  it("includes mermaidBlock extension (has settings in registry)", () => {
    const result = getExtensionsWithSettings();
    const names = result.map((e) => e.name);
    expect(names).toContain("mermaidBlock");
  });
});

// ─── Settings schema validation ────────────────────────────────────────────────

describe("Settings schema — codeBlock", () => {
  let codeBlockSettings: SettingDef[];

  beforeEach(() => {
    const ext = getExtensionsWithSettings().find(
      (e) => e.name === "codeBlock",
    )!;
    codeBlockSettings = ext.settings;
  });

  it("has codeBlockLineNumbers boolean setting", () => {
    const s = codeBlockSettings.find((s) => s.key === "codeBlockLineNumbers")!;
    expect(s).toBeDefined();
    expect(s.type).toBe("boolean");
    expect(s.default).toBe(false);
  });

  it("has codeBlockStyle select setting with 4 options", () => {
    const s = codeBlockSettings.find((s) => s.key === "codeBlockStyle")!;
    expect(s).toBeDefined();
    expect(s.type).toBe("select");
    expect(s.options).toHaveLength(4);
    const values = s.options!.map((o) => o.value);
    expect(values).toContain("default");
    expect(values).toContain("minimal");
    expect(values).toContain("contrast");
    expect(values).toContain("paper");
  });

  it("every setting has key, type, label, description, and default", () => {
    for (const s of codeBlockSettings) {
      expect(typeof s.key).toBe("string");
      expect(["boolean", "select", "number", "string"]).toContain(s.type);
      expect(typeof s.label).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(s.default).not.toBeUndefined();
    }
  });
});

describe("Settings schema — mermaidBlock", () => {
  it("has diagrams boolean setting defaulting to true", () => {
    const ext = getExtensionsWithSettings().find(
      (e) => e.name === "mermaidBlock",
    )!;
    const s = ext.settings.find((s) => s.key === "diagrams")!;
    expect(s).toBeDefined();
    expect(s.type).toBe("boolean");
    expect(s.default).toBe(true);
  });
});

// ─── formatName helper ────────────────────────────────────────────────────────

describe("formatName", () => {
  it("converts codeBlock → Code Block", () => {
    expect(formatName("codeBlock")).toBe("Code Block");
  });

  it("converts mermaidBlock → Mermaid Block", () => {
    expect(formatName("mermaidBlock")).toBe("Mermaid Block");
  });

  it("leaves single-word names unchanged (capitalized)", () => {
    expect(formatName("heading")).toBe("Heading");
  });

  it("handles multiple uppercase letters", () => {
    expect(formatName("tableOfContents")).toBe("Table Of Contents");
  });
});

// ─── setExtensionSetting (store integration) ──────────────────────────────────

describe("setExtensionSetting", () => {
  it("stores arbitrary key-value in extensionSettings", () => {
    useSettingsStore.getState().setExtensionSetting("myKey", "myValue");
    expect(useSettingsStore.getState().extensionSettings["myKey"]).toBe(
      "myValue",
    );
  });

  it("stores boolean false", () => {
    useSettingsStore
      .getState()
      .setExtensionSetting("codeBlockLineNumbers", false);
    expect(
      useSettingsStore.getState().extensionSettings["codeBlockLineNumbers"],
    ).toBe(false);
  });

  it("preserves existing keys when adding a new one", () => {
    useSettingsStore.getState().setExtensionSetting("a", 1);
    useSettingsStore.getState().setExtensionSetting("b", 2);
    const ext = useSettingsStore.getState().extensionSettings;
    expect(ext["a"]).toBe(1);
    expect(ext["b"]).toBe(2);
  });

  it("overwrites existing key", () => {
    useSettingsStore.getState().setExtensionSetting("diagrams", true);
    useSettingsStore.getState().setExtensionSetting("diagrams", false);
    expect(useSettingsStore.getState().extensionSettings["diagrams"]).toBe(
      false,
    );
  });

  it("backward-compat: syncs codeBlockLineNumbers to top-level field", () => {
    useSettingsStore
      .getState()
      .setExtensionSetting("codeBlockLineNumbers", true);
    expect(useSettingsStore.getState().codeBlockLineNumbers).toBe(true);
  });

  it("backward-compat: syncs codeBlockStyle to top-level field", () => {
    useSettingsStore
      .getState()
      .setExtensionSetting("codeBlockStyle", "minimal");
    expect(useSettingsStore.getState().codeBlockStyle).toBe("minimal");
  });

  it("backward-compat: syncs diagrams to top-level field", () => {
    useSettingsStore.getState().setExtensionSetting("diagrams", false);
    expect(useSettingsStore.getState().diagrams).toBe(false);
  });
});

// ─── Value resolution: extensionSettings takes precedence over defaults ────────

describe("Setting value resolution", () => {
  it("falls back to schema default when extensionSettings has no value", () => {
    const ext = getExtensionsWithSettings().find(
      (e) => e.name === "codeBlock",
    )!;
    const setting = ext.settings.find((s) => s.key === "codeBlockLineNumbers")!;

    // Simulate what ExtensionSettingRow does: extensionSettings[key] ?? setting.default
    const stored =
      useSettingsStore.getState().extensionSettings["codeBlockLineNumbers"];
    const resolved = stored ?? setting.default;
    expect(resolved).toBe(false);
  });

  it("uses stored value over schema default when set", () => {
    useSettingsStore
      .getState()
      .setExtensionSetting("codeBlockLineNumbers", true);
    const ext = getExtensionsWithSettings().find(
      (e) => e.name === "codeBlock",
    )!;
    const setting = ext.settings.find((s) => s.key === "codeBlockLineNumbers")!;

    const stored =
      useSettingsStore.getState().extensionSettings["codeBlockLineNumbers"];
    const resolved = stored ?? setting.default;
    expect(resolved).toBe(true);
  });
});
