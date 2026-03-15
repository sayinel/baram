// Integration: AI Enhancement — cross-feature integration tests (§11.2–§11.8)
import { beforeEach, describe, expect, it } from "vitest";

import { useAgentStore } from "../../stores/agent-store";
import { useAIStore } from "../../stores/ai/ai";
import { useAuthorshipStore } from "../../stores/authorship-store";
import { useKnowledgeStore } from "../../stores/knowledge-store";
import { useWritingFlowStore } from "../../stores/writing-flow-store";
import { detectRisk } from "../../utils/agent-risk-detector";
import { AuthorshipTracker } from "../../utils/authorship-tracker";
import {
  buildContextPrompt,
  isVaultQuery,
  parseReferences,
  resolveReference,
} from "../../utils/chat-context";
import { extractEntities } from "../../utils/entity-extractor";
import { getConfigForTask } from "../../utils/model-selection";
import { isLLMAllowed } from "../../utils/privacy-check";
import {
  buildTemplatePrompt,
  getBuiltinTemplates,
  getTemplateById,
} from "../../utils/smart-templates";
import {
  type DetectorInput,
  detectWritingMode,
} from "../../utils/writing-mode-detector";

// ---------------------------------------------------------------------------
// §11.2 Per-task Model Routing
// ---------------------------------------------------------------------------
describe("Integration: Per-task Model Routing", () => {
  beforeEach(() => {
    useAIStore.setState({
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      apiKeys: { claude: "sk-claude", openai: "sk-openai" },
      apiKey: "sk-claude",
      ollamaUrl: "http://localhost:11434",
      autoModelEnabled: false,
      providerForGhostText: "",
      providerForInlineEdit: "",
      providerForChat: "",
      providerForAgent: "",
      modelForGhostText: "",
      modelForInlineEdit: "",
      modelForChat: "",
      modelForAgent: "",
    });
  });

  it("returns default config when autoModel is disabled", () => {
    const cfg = getConfigForTask("ghost-text");
    expect(cfg.provider).toBe("claude");
    expect(cfg.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("returns per-task provider when autoModel is enabled", () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerForGhostText: "openai",
      modelForGhostText: "gpt-4o-mini",
    });

    const ghostCfg = getConfigForTask("ghost-text");
    expect(ghostCfg.provider).toBe("openai");
    expect(ghostCfg.model).toBe("gpt-4o-mini");

    // Chat still falls back to default since no per-task override
    const chatCfg = getConfigForTask("chat");
    expect(chatCfg.provider).toBe("claude");
    expect(chatCfg.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("resolves API key for the per-task provider", () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerForGhostText: "openai",
    });

    const cfg = getConfigForTask("ghost-text");
    expect(cfg.provider).toBe("openai");
    expect(cfg.apiKey).toBe("sk-openai");
  });

  it("returns ollama base URL for ollama provider", () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerForAgent: "ollama",
      modelForAgent: "llama3",
    });

    const cfg = getConfigForTask("agent");
    expect(cfg.provider).toBe("ollama");
    expect(cfg.baseUrl).toBe("http://localhost:11434");
  });
});

// ---------------------------------------------------------------------------
// §11.3 Writing Flow → Ghost Text integration
// ---------------------------------------------------------------------------
describe("Integration: Writing Flow → Ghost Text", () => {
  beforeEach(() => {
    useWritingFlowStore.getState().reset();
  });

  it("technical mode injects technical prompt into composite context", () => {
    useWritingFlowStore.getState().setMode("technical", 0.8);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("technical terminology");
    expect(ctx).toContain("Continue the user's text naturally");
  });

  it("academic mode injects academic prompt", () => {
    useWritingFlowStore.getState().setMode("academic", 0.95);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("formal academic tone");
    expect(ctx).toContain("LaTeX");
  });

  it("journal mode injects personal/reflective prompt", () => {
    useWritingFlowStore.getState().setMode("journal", 0.9);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("reflective");
    expect(ctx).toContain("first-person");
  });

  it("session memory rejections appear in composite context", () => {
    useWritingFlowStore.getState().switchFile("test.md");
    const memory = useWritingFlowStore.getState().getSessionMemory();
    memory.recordRejection("bad suggestion 1");
    memory.recordRejection("bad suggestion 2");

    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("DO NOT suggest");
    expect(ctx).toContain("bad suggestion 1");
  });

  it("session memory avoid/prefer patterns appear in composite context", () => {
    useWritingFlowStore.getState().switchFile("test.md");
    const memory = useWritingFlowStore.getState().getSessionMemory();
    memory.addAvoidPattern("passive voice");
    memory.addPreferPattern("short sentences");

    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("Avoid: passive voice");
    expect(ctx).toContain("Prefer: short sentences");
  });

  it("switching files creates separate session memories", () => {
    useWritingFlowStore.getState().switchFile("a.md");
    useWritingFlowStore
      .getState()
      .getSessionMemory()
      .recordRejection("reject-a");

    useWritingFlowStore.getState().switchFile("b.md");
    useWritingFlowStore
      .getState()
      .getSessionMemory()
      .recordRejection("reject-b");

    // Switch back to a.md
    useWritingFlowStore.getState().switchFile("a.md");
    const memA = useWritingFlowStore.getState().getSessionMemory();
    expect(memA.getRejections()).toContain("reject-a");
    expect(memA.getRejections()).not.toContain("reject-b");
  });
});

// ---------------------------------------------------------------------------
// §11.3 Writing Mode Detection
// ---------------------------------------------------------------------------
describe("Integration: Writing Mode Detection → Writing Flow Store", () => {
  beforeEach(() => {
    useWritingFlowStore.getState().reset();
  });

  it("detectWritingMode → setMode → compositePromptContext pipeline", () => {
    const input: DetectorInput = {
      filePath: "docs/api-design.md",
      frontmatter: {},
      nodeTypes: { codeBlock: 5, paragraph: 10 },
    };

    const result = detectWritingMode(input);
    expect(result.mode).toBe("technical");

    useWritingFlowStore.getState().setMode(result.mode, result.confidence);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("technical terminology");
  });

  it("frontmatter type=paper overrides path-based detection", () => {
    const input: DetectorInput = {
      filePath: "journal/2026-01-01.md",
      frontmatter: { type: "paper" },
      nodeTypes: {},
    };

    const result = detectWritingMode(input);
    expect(result.mode).toBe("academic");
    expect(result.confidence).toBe(0.95);
  });

  it("skills path produces skills mode", () => {
    const input: DetectorInput = {
      filePath: "skills/summarize.skill.md",
      frontmatter: {},
      nodeTypes: {},
    };

    const result = detectWritingMode(input);
    expect(result.mode).toBe("skills");

    useWritingFlowStore.getState().setMode(result.mode, result.confidence);
    const ctx = useWritingFlowStore.getState().compositePromptContext();
    expect(ctx).toContain("prompt/skill file syntax");
  });
});

// ---------------------------------------------------------------------------
// §11.3 + §49 Privacy mode blocks AI for private files
// ---------------------------------------------------------------------------
describe("Integration: Privacy Mode", () => {
  it("blocks cloud providers when privacyMode is true", () => {
    expect(isLLMAllowed(true, "claude")).toBe(false);
    expect(isLLMAllowed(true, "openai")).toBe(false);
    expect(isLLMAllowed(true, "gemini")).toBe(false);
  });

  it("allows Ollama when privacyMode is true", () => {
    expect(isLLMAllowed(true, "ollama")).toBe(true);
  });

  it("allows all providers when privacyMode is false", () => {
    expect(isLLMAllowed(false, "claude")).toBe(true);
    expect(isLLMAllowed(false, "openai")).toBe(true);
    expect(isLLMAllowed(false, "ollama")).toBe(true);
  });

  it("per-file privacy overrides global setting", () => {
    // Global privacy off, but file privacy on → blocks cloud
    expect(isLLMAllowed(false, "claude", true)).toBe(false);
    expect(isLLMAllowed(false, "ollama", true)).toBe(true);
  });

  it("privacy + model routing: per-task config still respects privacy check", () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerForGhostText: "openai",
      modelForGhostText: "gpt-4o",
      privacyMode: true,
    });

    const cfg = getConfigForTask("ghost-text");
    expect(cfg.provider).toBe("openai");
    // The config itself resolves — privacy check is enforced at callsite
    expect(isLLMAllowed(true, cfg.provider)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §11.4 Knowledge Q&A — Store lifecycle
// ---------------------------------------------------------------------------
describe("Integration: Knowledge Store Lifecycle", () => {
  beforeEach(() => {
    useKnowledgeStore.getState().reset();
  });

  it("transitions: idle → indexing → ready", () => {
    expect(useKnowledgeStore.getState().indexingStatus).toBe("idle");

    useKnowledgeStore.getState().setIndexingProgress(5, 20);
    expect(useKnowledgeStore.getState().indexingStatus).toBe("indexing");
    expect(useKnowledgeStore.getState().indexedFiles).toBe(5);
    expect(useKnowledgeStore.getState().totalFiles).toBe(20);

    useKnowledgeStore.getState().setIndexingProgress(20, 20);
    expect(useKnowledgeStore.getState().indexingStatus).toBe("ready");
  });

  it("transitions: indexing → error", () => {
    useKnowledgeStore.getState().setIndexingProgress(5, 20);
    useKnowledgeStore.getState().setError("Connection failed");
    expect(useKnowledgeStore.getState().indexingStatus).toBe("error");
    expect(useKnowledgeStore.getState().error).toBe("Connection failed");
  });

  it("reset clears all state", () => {
    useKnowledgeStore.getState().setIndexingProgress(10, 20);
    useKnowledgeStore.getState().setTotalChunks(150);
    useKnowledgeStore.getState().reset();

    expect(useKnowledgeStore.getState().indexingStatus).toBe("idle");
    expect(useKnowledgeStore.getState().indexedFiles).toBe(0);
    expect(useKnowledgeStore.getState().totalChunks).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §11.4 Chat @vault/@folder references
// ---------------------------------------------------------------------------
describe("Integration: @vault/@folder references", () => {
  it("parseReferences extracts @vault", () => {
    const refs = parseReferences("@vault 이 프로젝트에서 검색해줘");
    expect(refs).toContain("@vault");
  });

  it("parseReferences extracts @folder:path", () => {
    const refs = parseReferences("Look at @folder:src/components for patterns");
    expect(refs).toContain("@folder:src/components");
  });

  it("resolveReference(@vault) returns pending placeholder", () => {
    const resolved = resolveReference("@vault");
    expect(resolved).not.toBeNull();
    expect(resolved!.type).toBe("@vault");
    expect(resolved!.content).toContain("vault search pending");
  });

  it("isVaultQuery detects @vault reference", () => {
    expect(isVaultQuery("@vault search for API patterns")).toBe(true);
  });

  it("isVaultQuery detects Korean keyword heuristics", () => {
    expect(isVaultQuery("이 프로젝트에서 인증 로직을 찾아줘")).toBe(true);
    expect(isVaultQuery("vault에서 검색해줘")).toBe(true);
  });

  it("isVaultQuery returns false for regular messages", () => {
    expect(isVaultQuery("What is a closure in JavaScript?")).toBe(false);
  });

  it("buildContextPrompt includes resolved references", () => {
    const prompt = buildContextPrompt("Explain this", [
      { type: "@vault", label: "Vault Search", content: "relevant content" },
    ]);
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("relevant content");
    expect(prompt).toContain("Explain this");
  });
});

// ---------------------------------------------------------------------------
// §11.5 Semantic Wikilink — Entity Extraction
// ---------------------------------------------------------------------------
describe("Integration: Entity Extraction", () => {
  it("finds dictionary entities in text", () => {
    const dict = new Set(["React", "TypeScript", "Zustand"]);
    const text = "We use React and TypeScript with Zustand for state.";
    const found = extractEntities(text, dict);
    expect(found).toContain("React");
    expect(found).toContain("TypeScript");
    expect(found).toContain("Zustand");
  });

  it("excludes already-linked entities", () => {
    const dict = new Set(["React", "Zustand"]);
    const text = "[[React]] is great. Zustand is also useful.";
    const found = extractEntities(text, dict);
    expect(found).not.toContain("React");
    expect(found).toContain("Zustand");
  });

  it("case-insensitive matching returns original casing", () => {
    const dict = new Set(["ProseMirror"]);
    const text = "using prosemirror for editing.";
    const found = extractEntities(text, dict);
    expect(found).toContain("ProseMirror");
  });

  it("empty dictionary returns empty", () => {
    const found = extractEntities("some text", new Set());
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §11.6 Agent Mode — State Machine Lifecycle
// ---------------------------------------------------------------------------
describe("Integration: Agent Mode State Machine", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("full lifecycle: idle → planning → reviewing → executing → completed", () => {
    const store = useAgentStore;

    expect(store.getState().status).toBe("idle");

    // Start planning
    store.getState().startPlanning("Refactor authentication module");
    expect(store.getState().status).toBe("planning");
    expect(store.getState().goal).toBe("Refactor authentication module");

    // Set plan → transitions to reviewing
    store.getState().setPlan({
      steps: [
        { action: "edit", file: "auth.ts", risk: "low" },
        { action: "edit", file: "session.ts", risk: "medium" },
      ],
    });
    expect(store.getState().status).toBe("reviewing");
    expect(store.getState().totalSteps).toBe(2);

    // Approve plan → transitions to executing
    store.getState().approvePlan();
    expect(store.getState().status).toBe("executing");

    // Complete steps
    store.getState().completeStep(0, { diff: "- old\n+ new", file: "auth.ts" });
    expect(store.getState().completedSteps).toBe(1);

    store
      .getState()
      .completeStep(1, { diff: "- old\n+ new", file: "session.ts" });
    expect(store.getState().completedSteps).toBe(2);

    // Finish
    store.getState().finish();
    expect(store.getState().status).toBe("completed");
  });

  it("pause on risk and resume", () => {
    useAgentStore.getState().startPlanning("Dangerous operation");
    useAgentStore.getState().setPlan({
      steps: [{ action: "delete", file: "critical.ts", risk: "high" }],
    });
    useAgentStore.getState().approvePlan();
    expect(useAgentStore.getState().status).toBe("executing");

    // Pause
    useAgentStore.getState().pauseOnRisk("High risk: file deletion");
    expect(useAgentStore.getState().status).toBe("paused");
    expect(useAgentStore.getState().pauseReason).toBe(
      "High risk: file deletion",
    );

    // Resume
    useAgentStore.getState().resume();
    expect(useAgentStore.getState().status).toBe("executing");
    expect(useAgentStore.getState().pauseReason).toBe("");
  });

  it("cancel from any state returns to idle", () => {
    useAgentStore.getState().startPlanning("Task");
    useAgentStore.getState().setPlan({
      steps: [{ action: "edit", file: "a.ts", risk: "low" }],
    });
    expect(useAgentStore.getState().status).toBe("reviewing");

    useAgentStore.getState().cancel();
    expect(useAgentStore.getState().status).toBe("idle");
    expect(useAgentStore.getState().plan).toBeNull();
    expect(useAgentStore.getState().goal).toBe("");
  });
});

// ---------------------------------------------------------------------------
// §11.6 Agent Risk Detection integration
// ---------------------------------------------------------------------------
describe("Integration: Agent Risk Detection", () => {
  it("detects low risk for minor text changes", () => {
    const original = "# Title\n\nSome content here.";
    const modified = "# Title\n\nSome updated content here.";
    expect(detectRisk(original, modified)).toBe("low");
  });

  it("detects medium risk for heading structure changes", () => {
    const original =
      "# Title\n\n## Section A\n\nContent A\n\n## Section B\n\nContent B";
    const modified =
      "# Title\n\n## New Section\n\nContent A\n\n## Also New\n\nContent B";
    expect(detectRisk(original, modified)).toBe("medium");
  });

  it("detects medium risk for frontmatter field changes", () => {
    const original = "---\ntitle: Test\ntags: [a]\n---\n\n# Content";
    const modified =
      "---\ntitle: Test\ntags: [a]\nstatus: draft\n---\n\n# Content";
    expect(detectRisk(original, modified)).toBe("medium");
  });

  it("detects high risk for >50% content change without heading changes", () => {
    // Same heading to avoid medium-risk shortcircuit from heading structure change
    const original =
      "# Title\n\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6";
    const modified =
      "# Title\n\nCompletely different\nAll new content\nNothing the same\nReplaced everything\nBrand new\nFresh text";
    expect(detectRisk(original, modified)).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// §11.7 Authorship — tracker + store integration
// ---------------------------------------------------------------------------
describe("Integration: Authorship Tracking", () => {
  beforeEach(() => {
    useAuthorshipStore.getState().reset();
  });

  it("store enabled state toggles", () => {
    expect(useAuthorshipStore.getState().isEnabled).toBe(false);
    useAuthorshipStore.getState().setEnabled(true);
    expect(useAuthorshipStore.getState().isEnabled).toBe(true);
  });

  it("per-file tracker creation and retrieval", () => {
    useAuthorshipStore.getState().setEnabled(true);

    const tracker1 = useAuthorshipStore
      .getState()
      .getOrCreateTracker("file1.md");
    const tracker2 = useAuthorshipStore
      .getState()
      .getOrCreateTracker("file2.md");
    expect(tracker1).not.toBe(tracker2);

    // Same file returns same tracker
    const tracker1Again = useAuthorshipStore
      .getState()
      .getOrCreateTracker("file1.md");
    expect(tracker1Again).toBe(tracker1);
  });

  it("AI generation + human edit → stats update correctly", () => {
    const tracker = new AuthorshipTracker();

    // AI generates text at positions 0–100
    tracker.recordAIGenerated(0, 100, {
      provider: "claude",
      model: "sonnet",
      action: "ghost-text",
    });

    let stats = tracker.getStats(100);
    expect(stats.aiGeneratedPercent).toBe(100);
    expect(stats.humanPercent).toBe(0);

    // Human edits positions 50–75
    tracker.recordHumanEdit(50, 75);

    stats = tracker.getStats(100);
    // 0–50 AI (50), 50–75 human (25), 75–100 AI (25)
    expect(stats.aiGeneratedPercent).toBe(75); // 50+25 = 75
    expect(stats.humanPercent).toBe(25);
  });

  it("untracked regions count as human", () => {
    const tracker = new AuthorshipTracker();
    tracker.recordAIGenerated(0, 20, {
      provider: "openai",
      model: "gpt-4o",
      action: "inline-edit",
    });

    const stats = tracker.getStats(100);
    expect(stats.aiGeneratedPercent).toBe(20);
    expect(stats.humanPercent).toBe(80);
  });

  it("reset clears all trackers", () => {
    useAuthorshipStore.getState().setEnabled(true);
    useAuthorshipStore.getState().getOrCreateTracker("file.md");
    expect(useAuthorshipStore.getState().hasTracker("file.md")).toBe(true);

    useAuthorshipStore.getState().reset();
    expect(useAuthorshipStore.getState().hasTracker("file.md")).toBe(false);
    expect(useAuthorshipStore.getState().isEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §11.8 Smart Templates
// ---------------------------------------------------------------------------
describe("Integration: Smart Templates", () => {
  it("all 7 built-in templates are available", () => {
    const templates = getBuiltinTemplates();
    expect(templates).toHaveLength(7);
    expect(templates.map((t) => t.id)).toEqual(
      expect.arrayContaining([
        "api-doc",
        "meeting-notes",
        "tech-spec",
        "tutorial",
        "blog-post",
        "release-notes",
        "research-notes",
      ]),
    );
  });

  it("getTemplateById returns correct template", () => {
    const template = getTemplateById("tech-spec");
    expect(template).toBeDefined();
    expect(template!.name).toBe("Technical Spec");
    expect(template!.sections.length).toBeGreaterThan(0);
  });

  it("buildTemplatePrompt generates structured prompt", () => {
    const prompt = buildTemplatePrompt("api-doc", {
      projectName: "Baram",
      techStack: "Tauri + React",
    });

    expect(prompt).toContain("API Documentation");
    expect(prompt).toContain("## Sections");
    expect(prompt).toContain("Overview");
    expect(prompt).toContain("(required)");
    expect(prompt).toContain("## Context");
    expect(prompt).toContain("projectName: Baram");
    expect(prompt).toContain("techStack: Tauri + React");
  });

  it("buildTemplatePrompt returns empty for unknown template", () => {
    expect(buildTemplatePrompt("nonexistent")).toBe("");
  });

  it("buildTemplatePrompt without context omits context section", () => {
    const prompt = buildTemplatePrompt("meeting-notes");
    expect(prompt).toContain("Meeting Notes");
    expect(prompt).not.toContain("## Context");
  });
});

// ---------------------------------------------------------------------------
// Cross-feature: Model Routing + Writing Flow + Privacy
// ---------------------------------------------------------------------------
describe("Integration: Cross-feature Pipelines", () => {
  beforeEach(() => {
    useAIStore.setState({
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      apiKeys: { claude: "sk-claude", openai: "sk-openai", ollama: "" },
      apiKey: "sk-claude",
      autoModelEnabled: true,
      providerForGhostText: "openai",
      modelForGhostText: "gpt-4o-mini",
      privacyMode: false,
    });
    useWritingFlowStore.getState().reset();
  });

  it("ghost text pipeline: mode detection → prompt → model selection", () => {
    // 1. Detect mode for a docs/ file
    const result = detectWritingMode({
      filePath: "docs/architecture.md",
      frontmatter: {},
      nodeTypes: { codeBlock: 4, paragraph: 8 },
    });
    expect(result.mode).toBe("technical");

    // 2. Set writing mode
    useWritingFlowStore.getState().setMode(result.mode, result.confidence);

    // 3. Get composite prompt (would be appended to ghost text system prompt)
    const flowCtx = useWritingFlowStore.getState().compositePromptContext();
    expect(flowCtx).toContain("technical terminology");

    // 4. Resolve model config for ghost-text task
    const cfg = getConfigForTask("ghost-text");
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o-mini");

    // 5. Check privacy allows this
    expect(isLLMAllowed(false, cfg.provider)).toBe(true);
  });

  it("privacy mode blocks full pipeline even with per-task config", () => {
    useAIStore.setState({ privacyMode: true });

    const cfg = getConfigForTask("ghost-text");
    // Config resolves to openai...
    expect(cfg.provider).toBe("openai");
    // ...but privacy check blocks it
    expect(isLLMAllowed(true, cfg.provider)).toBe(false);
    // Only ollama would be allowed
    expect(isLLMAllowed(true, "ollama")).toBe(true);
  });

  it("agent mode + authorship: AI edits tracked with model info", () => {
    // Agent completes a step
    useAgentStore.getState().startPlanning("Improve docs");
    useAgentStore.getState().setPlan({
      steps: [{ action: "edit", file: "readme.md", risk: "low" }],
    });
    useAgentStore.getState().approvePlan();

    // Track the AI edit in authorship — use the resolved agent config
    const tracker = useAuthorshipStore
      .getState()
      .getOrCreateTracker("readme.md");
    const cfg = getConfigForTask("agent");
    tracker.recordAIGenerated(0, 200, {
      provider: cfg.provider,
      model: cfg.model,
      action: "agent-edit",
    });

    // Complete the agent step
    useAgentStore.getState().completeStep(0, {
      diff: "- old\n+ new",
      file: "readme.md",
    });
    useAgentStore.getState().finish();
    expect(useAgentStore.getState().status).toBe("completed");

    // Authorship reflects AI generation
    const stats = tracker.getStats(200);
    expect(stats.aiGeneratedPercent).toBe(100);

    // Segments have model info from the resolved config
    const segs = tracker.getSegments();
    expect(segs[0].meta?.provider).toBe(cfg.provider);
  });
});
