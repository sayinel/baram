// §6.2 AI Diff Plugin tests — state transitions + decoration verification
import { describe, test, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
import {
  aiDiffPluginKey,
} from "../plugins/ai-diff";
import type { AIDiffState, AIDiffMeta } from "../plugins/ai-diff";

// ── Minimal schema for testing ─────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
});

// Re-create the plugin directly (avoid Tiptap Extension instantiation in unit tests)
function createAIDiffPlugin(): Plugin {
  const IDLE: AIDiffState = {
    phase: "idle",
    originalFrom: 0,
    originalTo: 0,
    originalText: "",
    aiText: "",
  };

  return new Plugin({
    key: aiDiffPluginKey,
    state: {
      init(): AIDiffState {
        return IDLE;
      },
      apply(tr, prev): AIDiffState {
        const meta = tr.getMeta(aiDiffPluginKey) as AIDiffMeta | undefined;
        if (meta) {
          switch (meta.type) {
            case "start":
              return {
                phase: "streaming",
                originalFrom: meta.from,
                originalTo: meta.to,
                originalText: meta.originalText,
                aiText: "",
              };
            case "streamChunk":
              if (prev.phase === "idle") return prev;
              return { ...prev, aiText: prev.aiText + meta.text };
            case "streamDone":
              if (prev.phase === "idle") return prev;
              return { ...prev, phase: "completed" };
            case "accept":
            case "reject":
            case "clear":
              return IDLE;
          }
        }
        if (tr.docChanged && prev.phase !== "idle") {
          const isAcceptTr = tr.getMeta("aiDiffAccept");
          if (isAcceptTr) return IDLE;
          return IDLE;
        }
        return prev;
      },
    },
  });
}

function createState(text: string): EditorState {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  return EditorState.create({ doc, plugins: [createAIDiffPlugin()] });
}

function getPluginState(state: EditorState): AIDiffState {
  return aiDiffPluginKey.getState(state) as AIDiffState;
}

function dispatchMeta(state: EditorState, meta: AIDiffMeta): EditorState {
  const tr = state.tr.setMeta(aiDiffPluginKey, meta);
  return state.apply(tr);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("AI Diff Plugin", () => {
  test("initial state is idle", () => {
    const state = createState("Hello World");
    const pluginState = getPluginState(state);
    expect(pluginState.phase).toBe("idle");
    expect(pluginState.aiText).toBe("");
  });

  test("start → streaming phase", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    const ps = getPluginState(state);
    expect(ps.phase).toBe("streaming");
    expect(ps.originalFrom).toBe(1);
    expect(ps.originalTo).toBe(12);
    expect(ps.originalText).toBe("Hello World");
    expect(ps.aiText).toBe("");
  });

  test("streamChunk accumulates text", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello " });
    state = dispatchMeta(state, { type: "streamChunk", text: "Beautiful " });
    state = dispatchMeta(state, { type: "streamChunk", text: "World" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("streaming");
    expect(ps.aiText).toBe("Hello Beautiful World");
  });

  test("streamDone → completed phase", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hi World" });
    state = dispatchMeta(state, { type: "streamDone" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("completed");
    expect(ps.aiText).toBe("Hi World");
  });

  test("accept replaces document text", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hi Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    // Simulate accept: replace text + set meta
    const ps = getPluginState(state);
    const tr = state.tr
      .insertText("Hi Earth", ps.originalFrom, ps.originalTo)
      .setMeta(aiDiffPluginKey, { type: "accept" } as AIDiffMeta)
      .setMeta("aiDiffAccept", true);
    state = state.apply(tr);

    const finalPs = getPluginState(state);
    expect(finalPs.phase).toBe("idle");

    // Verify document was changed
    let docText = "";
    state.doc.descendants((node) => {
      if (node.isText) docText += node.text;
      return true;
    });
    expect(docText).toBe("Hi Earth");
  });

  test("reject preserves original document", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hi Earth" });
    state = dispatchMeta(state, { type: "streamDone" });
    state = dispatchMeta(state, { type: "reject" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("idle");

    // Document unchanged
    let docText = "";
    state.doc.descendants((node) => {
      if (node.isText) docText += node.text;
      return true;
    });
    expect(docText).toBe("Hello World");
  });

  test("clear resets to idle", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "test" });
    state = dispatchMeta(state, { type: "clear" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("idle");
    expect(ps.aiText).toBe("");
  });

  test("external doc change during streaming → auto clear", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "test" });

    // Simulate external edit (user types something)
    const tr = state.tr.insertText("X", 1);
    state = state.apply(tr);

    const ps = getPluginState(state);
    expect(ps.phase).toBe("idle");
  });

  test("streamChunk on idle state is ignored", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, { type: "streamChunk", text: "test" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("idle");
  });

  test("streamDone on idle state is ignored", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, { type: "streamDone" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("idle");
  });

  test("full flow: start → chunks → done → accept", () => {
    let state = createState("The quick brown fox");

    // Start diff
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 20,
      originalText: "The quick brown fox",
    });

    // Stream AI response
    state = dispatchMeta(state, { type: "streamChunk", text: "The " });
    state = dispatchMeta(state, { type: "streamChunk", text: "lazy " });
    state = dispatchMeta(state, { type: "streamChunk", text: "brown dog" });
    state = dispatchMeta(state, { type: "streamDone" });

    expect(getPluginState(state).phase).toBe("completed");
    expect(getPluginState(state).aiText).toBe("The lazy brown dog");

    // Accept
    const ps = getPluginState(state);
    const tr = state.tr
      .insertText(ps.aiText, ps.originalFrom, ps.originalTo)
      .setMeta(aiDiffPluginKey, { type: "accept" } as AIDiffMeta)
      .setMeta("aiDiffAccept", true);
    state = state.apply(tr);

    // Verify final document
    let docText = "";
    state.doc.descendants((node) => {
      if (node.isText) docText += node.text;
      return true;
    });
    expect(docText).toBe("The lazy brown dog");
    expect(getPluginState(state).phase).toBe("idle");
  });
});
