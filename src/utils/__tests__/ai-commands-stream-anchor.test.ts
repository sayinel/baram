// issue 374 — the AI stream anchor follows EVERY transaction the editor
// applies, not only the root one.
//
// executeAICommand keeps a live insertion position (`currentPos`) and maps it
// through each transaction so that edits landing above it — the user typing,
// a second command — move the anchor with the text. Tiptap's "transaction"
// event carries the root transaction AND the transactions plugins appended
// to it (`appendedTransactions`), and this repo has an appendTransaction that
// changes the document: syntax-reveal's cursor-out collapse turns `**bold**`
// back into `bold`, four positions shorter. A tracker that maps through the
// root alone keeps the pre-collapse offset, so the next token lands four
// positions late — inside whatever block follows.
//
// Two windows are pinned. The first is the stream itself (a collapse while
// tokens arrive). The second is the setup edit: inserting the target
// paragraph moves the selection out of an expanded range, so the collapse is
// appended to THAT transaction, before any listener could see it — the
// anchor derived from pre-insert positions is stale from the first token.
//
// Real editor, real syntax-reveal, real llm-stream; only the IPC boundary is
// doubled (the globally mocked `listen` hands us the token handler).
import { listen } from "@tauri-apps/api/event";

import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  llmCancel: vi.fn(() => Promise.resolve(true)),
  llmComplete: vi.fn(() => Promise.resolve()),
}));
// link.ts's Cmd+click path reaches the OS opener; keep it inert here.
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import type { AICommandOptions } from "../ai-commands";

import { createBaramExtensions } from "../../extensions";
import { llmComplete } from "../../ipc/invoke";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useAIStore } from "../../stores/ai/ai";
import { executeAICommand } from "../ai-commands";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Give the awaited IPC continuations a chance to run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const editors: Editor[] = [];

function loadEditor(markdown: string): Editor {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent(
    markdownToProsemirror(markdown, editor.schema).toJSON(),
  );
  return editor;
}

/** Text of every top-level block, in order. */
function blockTexts(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

/** Document position right after top-level block `index`. */
function positionAfterBlock(editor: Editor, index: number): number {
  let pos = 0;
  for (let i = 0; i <= index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos;
}

/**
 * Same two-step cursor move the syntax-reveal tests use: the first move clears
 * the plugin's "no expansion right after a doc change" guard, the second one
 * lands inside the mark and expands it.
 */
function moveCursorTo(editor: Editor, guardPos: number, targetPos: number) {
  editor.commands.setTextSelection(guardPos);
  editor.commands.setTextSelection(targetPos);
}

/** Start a command and hand back a token sender bound to its request id. */
async function startStream(editor: Editor, options?: AICommandOptions) {
  const handlers: Record<string, (e: unknown) => void> = {};
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers[event as string] = handler as (e: unknown) => void;
    return () => {};
  });
  const pending = deferred<void>();
  vi.mocked(llmComplete).mockReturnValueOnce(pending.promise);

  const running = executeAICommand(editor, "p", "s", options);
  await flush();
  const requestId = vi.mocked(llmComplete).mock.calls[0][2];

  return {
    async finish() {
      pending.resolve();
      await running;
    },
    async send(token: string) {
      handlers["llm:token"]?.({ payload: { requestId, token } });
      await flush();
    },
  };
}

const FIXTURE = "Hello **world** end\n\nTarget\n\nTail paragraph\n";

beforeEach(() => {
  useAIStore.setState({ autoModelEnabled: false, provider: "ollama" });
  vi.mocked(llmComplete).mockClear();
});

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("a syntax-reveal collapse appended while the stream is running", () => {
  it("shrinks the document above the anchor and the next token still lands in the AI paragraph", async () => {
    const editor = loadEditor(FIXTURE);
    const { finish, send } = await startStream(editor, {
      insertAfterPos: positionAfterBlock(editor, 1),
    });
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "Target",
      "",
      "Tail paragraph",
    ]);

    await send("A");
    expect(blockTexts(editor)[2]).toBe("A");

    // Expand `**world**` above the anchor: a ROOT transaction, +4 positions.
    moveCursorTo(editor, 2, 9);
    expect(blockTexts(editor)[0]).toBe("Hello **world** end");
    await send("B");
    expect(blockTexts(editor)[2]).toBe("AB");

    // Leave the range: the root transaction only moves the selection, the
    // collapse is APPENDED to it by syntax-reveal — −4 positions above the
    // anchor that only an appended-aware tracker sees.
    editor.commands.setTextSelection(2);
    expect(blockTexts(editor)[0]).toBe("Hello world end");

    await send("C");
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "Target",
      "ABC",
      "Tail paragraph",
    ]);

    await finish();
  });

  it("CONTROL: a collapse below the anchor leaves it where it is", async () => {
    const editor = loadEditor("Target\n\nTail **bold** end\n");
    const { finish, send } = await startStream(editor, {
      insertAfterPos: positionAfterBlock(editor, 0),
    });
    await send("A");
    expect(blockTexts(editor)).toEqual(["Target", "A", "Tail bold end"]);

    // "Tail bold end" starts at positionAfterBlock(1); its 'b' sits 6 in.
    const tailStart = positionAfterBlock(editor, 1) + 1;
    moveCursorTo(editor, tailStart + 1, tailStart + 6);
    expect(blockTexts(editor)[2]).toBe("Tail **bold** end");
    await send("B");

    editor.commands.setTextSelection(tailStart + 1);
    expect(blockTexts(editor)[2]).toBe("Tail bold end");
    await send("C");

    expect(blockTexts(editor)).toEqual(["Target", "ABC", "Tail bold end"]);
    await finish();
  });
});

describe("a syntax-reveal collapse appended to the SETUP edit", () => {
  // The caller computed its insert position on the expanded document. Our
  // paragraph insert moves the selection out of the range, syntax-reveal
  // appends the collapse to that same transaction, and the document is four
  // positions shorter above the new paragraph before the first token.
  it("insertAfterPos: the first token lands in the new paragraph, not four positions late", async () => {
    const editor = loadEditor(FIXTURE);
    moveCursorTo(editor, 2, 9);
    expect(blockTexts(editor)[0]).toBe("Hello **world** end");

    const { finish, send } = await startStream(editor, {
      insertAfterPos: positionAfterBlock(editor, 1),
    });
    // The collapse already happened, appended to the paragraph insert.
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "Target",
      "",
      "Tail paragraph",
    ]);

    await send("A");
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "Target",
      "A",
      "Tail paragraph",
    ]);
    await finish();
  });

  it("afterSelection (floating toolbar): the paragraph after the expanded block receives the token", async () => {
    const editor = loadEditor(FIXTURE);
    moveCursorTo(editor, 2, 9);
    expect(blockTexts(editor)[0]).toBe("Hello **world** end");

    const { finish, send } = await startStream(editor, {
      afterSelection: true,
    });
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "",
      "Target",
      "Tail paragraph",
    ]);

    await send("A");
    expect(blockTexts(editor)).toEqual([
      "Hello world end",
      "A",
      "Target",
      "Tail paragraph",
    ]);
    await finish();
  });
});
