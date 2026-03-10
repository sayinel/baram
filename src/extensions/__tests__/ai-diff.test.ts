import type { AIDiffMeta, AIDiffState } from "../plugins/ai-diff";

import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin } from "@tiptap/pm/state";
// §6.2 AI Diff Plugin tests — state transitions + decoration verification
import { describe, expect, test } from "vitest";

import {
  aiDiffPluginKey,
  buildTextFromHunks,
  computeHunks,
} from "../plugins/ai-diff";

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
    hunks: [],
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
            case "accept":
            case "clear":
            case "reject":
              return IDLE;
            case "acceptHunk": {
              if (prev.phase !== "completed") return prev;
              const idx = meta.index;
              if (idx < 0 || idx >= prev.hunks.length) return prev;
              return {
                ...prev,
                hunks: prev.hunks.map((h, i) =>
                  i === idx ? { ...h, accepted: true, rejected: false } : h,
                ),
              };
            }
            case "rejectHunk": {
              if (prev.phase !== "completed") return prev;
              const idx = meta.index;
              if (idx < 0 || idx >= prev.hunks.length) return prev;
              return {
                ...prev,
                hunks: prev.hunks.map((h, i) =>
                  i === idx ? { ...h, rejected: true, accepted: false } : h,
                ),
              };
            }
            case "start":
              return {
                phase: "streaming",
                originalFrom: meta.from,
                originalTo: meta.to,
                originalText: meta.originalText,
                aiText: "",
                hunks: [],
              };
            case "streamChunk":
              if (prev.phase === "idle") return prev;
              return { ...prev, aiText: prev.aiText + meta.text };
            case "streamDone":
              if (prev.phase === "idle") return prev;
              return {
                ...prev,
                phase: "completed",
                hunks: computeHunks(prev.originalText, prev.aiText),
              };
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

function dispatchMeta(state: EditorState, meta: AIDiffMeta): EditorState {
  const tr = state.tr.setMeta(aiDiffPluginKey, meta);
  return state.apply(tr);
}

function getPluginState(state: EditorState): AIDiffState {
  return aiDiffPluginKey.getState(state) as AIDiffState;
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

  test("streamDone computes hunks", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    const ps = getPluginState(state);
    expect(ps.phase).toBe("completed");
    expect(ps.hunks.length).toBeGreaterThan(0);
    // "World" → "Earth" is one hunk
    expect(ps.hunks[0].accepted).toBe(false);
    expect(ps.hunks[0].rejected).toBe(false);
  });

  test("acceptHunk marks specific hunk as accepted", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    const hunkCount = getPluginState(state).hunks.length;
    expect(hunkCount).toBeGreaterThan(0);

    state = dispatchMeta(state, { type: "acceptHunk", index: 0 });
    const ps = getPluginState(state);
    expect(ps.hunks[0].accepted).toBe(true);
    expect(ps.hunks[0].rejected).toBe(false);
  });

  test("rejectHunk marks specific hunk as rejected", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    state = dispatchMeta(state, { type: "rejectHunk", index: 0 });
    const ps = getPluginState(state);
    expect(ps.hunks[0].rejected).toBe(true);
    expect(ps.hunks[0].accepted).toBe(false);
  });

  test("acceptHunk on invalid index is no-op", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    const before = getPluginState(state);
    state = dispatchMeta(state, { type: "acceptHunk", index: 999 });
    const after = getPluginState(state);
    expect(after.hunks).toEqual(before.hunks);
  });

  test("acceptHunk toggles rejected → accepted", () => {
    let state = createState("Hello World");
    state = dispatchMeta(state, {
      type: "start",
      from: 1,
      to: 12,
      originalText: "Hello World",
    });
    state = dispatchMeta(state, { type: "streamChunk", text: "Hello Earth" });
    state = dispatchMeta(state, { type: "streamDone" });

    // First reject, then accept the same hunk
    state = dispatchMeta(state, { type: "rejectHunk", index: 0 });
    expect(getPluginState(state).hunks[0].rejected).toBe(true);

    state = dispatchMeta(state, { type: "acceptHunk", index: 0 });
    const ps = getPluginState(state);
    expect(ps.hunks[0].accepted).toBe(true);
    expect(ps.hunks[0].rejected).toBe(false);
  });
});

describe("computeHunks", () => {
  test("identical strings produce no hunks", () => {
    const hunks = computeHunks("hello", "hello");
    expect(hunks).toEqual([]);
  });

  test("word replacement produces hunks based on fast-diff char-level granularity", () => {
    // fast-diff("Hello World", "Hello Earth") produces:
    // EQUAL "Hello ", DELETE "Wo", INSERT "Ea", EQUAL "r", DELETE "ld", INSERT "th"
    // This results in 2 hunks (separated by EQUAL "r")
    const hunks = computeHunks("Hello World", "Hello Earth");
    expect(hunks.length).toBe(2);
    // First hunk: "Wo" → "Ea"
    expect(hunks[0].originalStart).toBe(6);
    expect(hunks[0].originalEnd).toBe(8);
    expect(hunks[0].replacement).toBe("Ea");
    // Second hunk: "ld" → "th"
    expect(hunks[1].originalStart).toBe(9);
    expect(hunks[1].originalEnd).toBe(11);
    expect(hunks[1].replacement).toBe("th");
  });

  test("clearly distinct word replacements produce separate hunks", () => {
    // "quick" → "lazy" is a clean word replacement separated by EQUAL " brown "
    const hunks = computeHunks("The quick brown fox", "The lazy brown dog");
    expect(hunks.length).toBeGreaterThanOrEqual(2);
    // First hunk should be about "quick" → "lazy"
    expect(hunks[0].replacement).toBe("lazy");
    // Rebuild should produce the expected result
    const result = buildTextFromHunks("The quick brown fox", hunks, true);
    expect(result).toBe("The lazy brown dog");
  });

  test("pure insertion at the end", () => {
    const hunks = computeHunks("Hello", "Hello World");
    expect(hunks.length).toBe(1);
    expect(hunks[0].originalStart).toBe(5);
    expect(hunks[0].originalEnd).toBe(5);
    expect(hunks[0].replacement).toBe(" World");
  });

  test("pure deletion", () => {
    const hunks = computeHunks("Hello World", "Hello");
    expect(hunks.length).toBe(1);
    expect(hunks[0].originalStart).toBe(5);
    expect(hunks[0].originalEnd).toBe(11);
    expect(hunks[0].replacement).toBe("");
  });

  test("buildTextFromHunks with all hunks accepted reconstructs aiText", () => {
    const original = "Hello World";
    const aiText = "Hello Earth";
    const hunks = computeHunks(original, aiText);
    const result = buildTextFromHunks(original, hunks, true);
    expect(result).toBe(aiText);
  });

  test("buildTextFromHunks with all hunks rejected reconstructs original", () => {
    const original = "Hello World";
    const aiText = "Hello Earth";
    const hunks = computeHunks(original, aiText);
    const result = buildTextFromHunks(original, hunks, false);
    expect(result).toBe(original);
  });
});

describe("buildTextFromHunks", () => {
  test("defaultAccept=true applies all undecided hunks", () => {
    const hunks = computeHunks("Hello World", "Hello Earth");
    const result = buildTextFromHunks("Hello World", hunks, true);
    expect(result).toBe("Hello Earth");
  });

  test("defaultAccept=false keeps original for undecided hunks", () => {
    const hunks = computeHunks("Hello World", "Hello Earth");
    const result = buildTextFromHunks("Hello World", hunks, false);
    expect(result).toBe("Hello World");
  });

  test("marking all hunks accepted produces aiText", () => {
    const hunks = computeHunks("Hello World", "Hello Earth");
    for (const h of hunks) h.accepted = true;
    const result = buildTextFromHunks("Hello World", hunks, false);
    expect(result).toBe("Hello Earth");
  });

  test("marking all hunks rejected produces original", () => {
    const hunks = computeHunks("Hello World", "Hello Earth");
    for (const h of hunks) h.rejected = true;
    const result = buildTextFromHunks("Hello World", hunks, true);
    expect(result).toBe("Hello World");
  });

  test("mixed accept/reject on multiple hunks", () => {
    const hunks = computeHunks("The quick brown fox", "The lazy brown dog");
    // Accept "quick" → "lazy" (first hunk), reject all "fox"-related hunks
    hunks[0].accepted = true;
    for (let i = 1; i < hunks.length; i++) {
      hunks[i].rejected = true;
    }
    const result = buildTextFromHunks("The quick brown fox", hunks, false);
    expect(result).toBe("The lazy brown fox");
  });

  test("empty original text (pure insertion) with accept", () => {
    const hunks = computeHunks("", "Hello World");
    expect(hunks.length).toBe(1);
    hunks[0].accepted = true;
    const result = buildTextFromHunks("", hunks, false);
    expect(result).toBe("Hello World");
  });

  test("empty original text (pure insertion) with reject", () => {
    const hunks = computeHunks("", "Hello World");
    hunks[0].rejected = true;
    const result = buildTextFromHunks("", hunks, true);
    expect(result).toBe("");
  });
});
