import {
  KEYBINDING_CATEGORIES,
  CATEGORY_LABELS,
  KEYBINDING_REGISTRY,
  getKeybindingsByCategory,
  type KeybindingEntry,
} from "../keybinding-registry";

describe("KEYBINDING_CATEGORIES", () => {
  it("contains all 9 expected categories in order", () => {
    expect(KEYBINDING_CATEGORIES).toEqual([
      "file",
      "edit",
      "view",
      "search",
      "insert",
      "ai",
      "workspace",
      "journal",
      "formatting",
    ]);
  });
});

describe("CATEGORY_LABELS", () => {
  it("has an i18n key for every category", () => {
    for (const cat of KEYBINDING_CATEGORIES) {
      expect(CATEGORY_LABELS[cat]).toBe(`keybindings.category.${cat}`);
    }
  });
});

describe("KEYBINDING_REGISTRY", () => {
  it("all IDs are unique", () => {
    const ids = KEYBINDING_REGISTRY.map((e) => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all defaultKeys among customizable entries are unique", () => {
    const customizable = KEYBINDING_REGISTRY.filter((e) => e.customizable);
    const keys = customizable.map((e) => e.defaultKey);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("every entry has required fields", () => {
    for (const entry of KEYBINDING_REGISTRY) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe("string");
      expect(KEYBINDING_CATEGORIES).toContain(entry.category);
      expect(typeof entry.defaultKey).toBe("string");
      expect(entry.defaultKey.length).toBeGreaterThan(0);
      expect(typeof entry.customizable).toBe("boolean");
    }
  });

  it("label format matches 'keybindings.{category}.{shortName}'", () => {
    for (const entry of KEYBINDING_REGISTRY) {
      expect(entry.label).toMatch(/^keybindings\.\w+\.\w+$/);
      const [, cat] = entry.label.split(".");
      expect(cat).toBe(entry.category);
    }
  });

  it("contains all expected customizable file entries", () => {
    const ids = new Set(KEYBINDING_REGISTRY.map((e) => e.id));
    const expected = [
      "file.new",
      "file.open",
      "file.openFolder",
      "file.save",
      "file.saveAs",
      "file.closeTab",
    ];
    for (const id of expected) expect(ids).toContain(id);
  });

  it("contains all expected formatting entries as non-customizable", () => {
    const formatting = KEYBINDING_REGISTRY.filter(
      (e) => e.category === "formatting",
    );
    for (const entry of formatting) {
      expect(entry.customizable).toBe(false);
    }
    const ids = new Set(formatting.map((e) => e.id));
    const expected = [
      "formatting.bold",
      "formatting.italic",
      "formatting.underline",
      "formatting.strikethrough",
      "formatting.highlight",
      "formatting.inlineCode",
      "formatting.codeBlock",
      "formatting.mathBlock",
      "formatting.heading1",
      "formatting.heading2",
      "formatting.heading3",
      "formatting.bulletList",
      "formatting.orderedList",
      "formatting.taskList",
      "formatting.mermaid",
    ];
    for (const id of expected) expect(ids).toContain(id);
  });

  it("all customizable entries have customizable=true", () => {
    const nonFormatting = KEYBINDING_REGISTRY.filter(
      (e) => e.category !== "formatting",
    );
    for (const entry of nonFormatting) {
      expect(entry.customizable).toBe(true);
    }
  });

  it("specific defaultKeys are correct", () => {
    const byId = Object.fromEntries(KEYBINDING_REGISTRY.map((e) => [e.id, e]));
    expect(byId["file.save"].defaultKey).toBe("Mod+S");
    expect(byId["file.new"].defaultKey).toBe("Mod+N");
    expect(byId["edit.find"].defaultKey).toBe("Mod+F");
    expect(byId["formatting.bold"].defaultKey).toBe("Mod+B");
    expect(byId["formatting.italic"].defaultKey).toBe("Mod+I");
    expect(byId["journal.quickCapture"].defaultKey).toBe("Mod+Shift+N");
  });
});

describe("getKeybindingsByCategory", () => {
  let map: Map<string, KeybindingEntry[]>;

  beforeEach(() => {
    map = getKeybindingsByCategory();
  });

  it("returns a Map with all categories", () => {
    for (const cat of KEYBINDING_CATEGORIES) {
      expect(map.has(cat)).toBe(true);
    }
  });

  it("each entry is in the correct category bucket", () => {
    for (const [cat, entries] of map) {
      for (const entry of entries) {
        expect(entry.category).toBe(cat);
      }
    }
  });

  it("covers all registry entries", () => {
    let total = 0;
    for (const entries of map.values()) total += entries.length;
    expect(total).toBe(KEYBINDING_REGISTRY.length);
  });

  it("map keys appear in KEYBINDING_CATEGORIES order", () => {
    const keys = Array.from(map.keys());
    expect(keys).toEqual(KEYBINDING_CATEGORIES);
  });
});
