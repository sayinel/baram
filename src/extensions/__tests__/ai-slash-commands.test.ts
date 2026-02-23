// §6.2 Built-in AI Slash Commands — unit tests (post-UX refactor)
import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock Tauri API and stores before importing
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../ipc/invoke", () => ({
  llmComplete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../stores/ai-store", () => ({
  useAIStore: {
    getState: () => ({
      apiKey: "test-key",
      model: "claude-sonnet-4-5-20250929",
      provider: "claude",
      ollamaUrl: "http://localhost:11434",
      privacyMode: false,
      customCommands: [
        { id: "custom1", name: "Custom Test", prompt: "Do something with {{selection}}" },
      ],
    }),
  },
}));

// Minimal mock editor for buildSlashItems
function createMockEditor() {
  const chainObj: Record<string, unknown> = {};
  chainObj.focus = () => chainObj;
  chainObj.toggleHeading = () => chainObj;
  chainObj.toggleBulletList = () => chainObj;
  chainObj.toggleOrderedList = () => chainObj;
  chainObj.toggleTaskList = () => chainObj;
  chainObj.toggleBlockquote = () => chainObj;
  chainObj.setHorizontalRule = () => chainObj;
  chainObj.toggleCodeBlock = () => chainObj;
  chainObj.insertContent = () => chainObj;
  chainObj.insertTable = () => chainObj;
  chainObj.setTextSelection = () => chainObj;
  chainObj.deleteRange = () => chainObj;
  chainObj.insertContentAt = () => chainObj;
  chainObj.run = () => true;

  return {
    chain: () => chainObj,
    commands: {
      setCallout: vi.fn(),
      setToggle: vi.fn(),
      setMermaidBlock: vi.fn(),
    },
    state: {
      selection: { from: 0, to: 0, $from: { parent: { textContent: "" } } },
      doc: { textBetween: () => "", textContent: "" },
    },
  } as never;
}

import { buildSlashItems } from "../plugins/slash-command";

// All AI commands in slash menu (input-based + selection-based)
const SLASH_AI_IDS = [
  "ai-write",
  "ai-brainstorm",
  "ai-translate",
  "ai-summarize",
  "ai-expand",
  "ai-fix-grammar",
  "ai-explain",
];

describe("§6.2 AI Slash Commands (post-UX refactor)", () => {
  let items: ReturnType<typeof buildSlashItems>;

  beforeEach(() => {
    items = buildSlashItems(createMockEditor());
  });

  test("buildSlashItems includes all 7 AI commands", () => {
    const aiIds = items.filter((i) => SLASH_AI_IDS.includes(i.id)).map((i) => i.id);
    expect(aiIds).toEqual(SLASH_AI_IDS);
  });

  test.each(SLASH_AI_IDS)("AI command '%s' has category 'AI'", (id) => {
    const item = items.find((i) => i.id === id);
    expect(item).toBeDefined();
    expect(item!.category).toBe("AI");
  });

  test.each(SLASH_AI_IDS)("AI command '%s' has mdHint 'AI'", (id) => {
    const item = items.find((i) => i.id === id);
    expect(item!.mdHint).toBe("AI");
  });

  test.each(SLASH_AI_IDS)("AI command '%s' has a non-empty description", (id) => {
    const item = items.find((i) => i.id === id);
    expect(item!.description.length).toBeGreaterThan(0);
  });

  test.each(SLASH_AI_IDS)("AI command '%s' has an action function", (id) => {
    const item = items.find((i) => i.id === id);
    expect(typeof item!.action).toBe("function");
  });

  test("filtering by 'ai' returns all AI commands + custom + incidental matches", () => {
    const q = "ai";
    const filtered = items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
    // 7 built-in AI + 1 custom (category "AI")
    // + "Mermaid Diagram" (label "mermaid" contains "ai")
    // + "Toggle" (description "Collapsible details block" — "details" contains "ai")
    expect(filtered.length).toBe(10);
  });

  test("custom AI commands are still included", () => {
    const custom = items.find((i) => i.id === "ai-custom-custom1");
    expect(custom).toBeDefined();
    expect(custom!.label).toBe("Custom Test");
    expect(custom!.category).toBe("AI");
  });

  test("built-in AI items appear before custom AI items", () => {
    const aiItems = items.filter((i) => i.category === "AI");
    const firstBuiltinIdx = aiItems.findIndex((i) => i.id === "ai-write");
    const firstCustomIdx = aiItems.findIndex((i) => i.id.startsWith("ai-custom-"));
    expect(firstBuiltinIdx).toBeLessThan(firstCustomIdx);
  });

  test("ai-write label is 'AI Write'", () => {
    const item = items.find((i) => i.id === "ai-write");
    expect(item!.label).toBe("AI Write");
  });

  test("ai-brainstorm label is 'AI Brainstorm'", () => {
    const item = items.find((i) => i.id === "ai-brainstorm");
    expect(item!.label).toBe("AI Brainstorm");
  });
});
