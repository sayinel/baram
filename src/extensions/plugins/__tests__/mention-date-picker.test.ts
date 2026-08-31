// §316 `@` date picking — the calendar reaches the mention surface.
//
// Before this, every date other than today/yesterday/tomorrow had to be typed
// out in full as `@2026-08-30`. The design's rule for the new entry is narrow
// and worth pinning: it extends the EXISTING `@` surface (no `/date` command
// of its own), and what it inserts is always a mention — a REFERENCE — even on
// a task line, where a due date would be a field instead.
import type { Editor } from "@tiptap/core";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { askDateValue } = vi.hoisted(() => ({ askDateValue: vi.fn() }));
vi.mock("../../../utils/editor/ask-date", () => ({ askDateValue }));

// The real one registers against a live ProseMirror view; here the promise
// just needs to pass through so the branch under test is the dialog's answer.
vi.mock("../../../utils/editor/mutation-tasks", () => ({
  awaitBoundToEditor: (_view: unknown, pending: Promise<unknown>) => pending,
}));

vi.mock("../../../stores/file/file", () => ({
  useFileStore: { getState: () => ({ fileTree: [], rootPath: null }) },
}));

import {
  buildMentionItems,
  PICK_DATE_ID,
  runMentionCommand,
} from "../mention-suggest";

/** A chain stub that records what was called on it. */
function stubEditor() {
  const calls: { args: unknown[]; name: string }[] = [];
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of ["focus", "deleteRange", "insertMention", "run"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push({ args, name });
      return name === "run" ? true : chain;
    };
  }
  const editor = {
    chain: () => chain,
    view: {},
  } as unknown as Editor;
  return { calls, editor };
}

const RANGE = { from: 5, to: 9 };

function named(name: string, calls: { args: unknown[]; name: string }[]) {
  return calls.filter((c) => c.name === name);
}

beforeEach(() => vi.clearAllMocks());

describe("§316 the `@` menu offers a calendar", () => {
  it("lists a pick-a-date entry beside the quick dates", () => {
    const items = buildMentionItems("");
    const ids = items.map((i) => i.id);

    expect(ids).toContain("date-today");
    expect(ids).toContain(PICK_DATE_ID);
  });

  it("carries no value of its own — the value does not exist yet", () => {
    // ‼️ If it ever gained one, the non-picker branch of runMentionCommand
    // would happily insert that value as a mention.
    const pick = buildMentionItems("").find((i) => i.id === PICK_DATE_ID);

    expect(pick?.value).toBe("");
    expect(pick?.type).toBe("date");
  });

  it("is reachable by typing part of its label", () => {
    const ids = buildMentionItems("date").map((i) => i.id);

    expect(ids).toContain(PICK_DATE_ID);
  });
});

describe("§316 choosing it opens the calendar rather than inserting", () => {
  it("does not insert anything before the calendar answers", async () => {
    let settle: (v: null | string) => void = () => {};
    askDateValue.mockReturnValue(
      new Promise<null | string>((r) => (settle = r)),
    );
    const { calls, editor } = stubEditor();

    runMentionCommand({
      editor,
      props: {
        category: "date",
        id: PICK_DATE_ID,
        label: "",
        type: "date",
        value: "",
      },
      range: RANGE,
    });
    await Promise.resolve();

    expect(named("insertMention", calls)).toHaveLength(0);
    settle(null);
  });

  it("removes the @… text BEFORE opening the dialog", async () => {
    // ‼️ `range` is a position pair captured when the menu was built, and the
    // dialog is a suspension point. Deleting after it resolves would cut
    // whatever had drifted into those positions instead.
    let settle: (v: null | string) => void = () => {};
    askDateValue.mockReturnValue(
      new Promise<null | string>((r) => (settle = r)),
    );
    const { calls, editor } = stubEditor();

    runMentionCommand({
      editor,
      props: {
        category: "date",
        id: PICK_DATE_ID,
        label: "",
        type: "date",
        value: "",
      },
      range: RANGE,
    });
    await Promise.resolve();

    expect(named("deleteRange", calls)[0]?.args[0]).toEqual(RANGE);
    settle(null);
  });

  it("inserts a date mention once the calendar answers", async () => {
    askDateValue.mockResolvedValue("2026-09-30");
    const { calls, editor } = stubEditor();

    await runMentionCommandAsync(editor);

    expect(named("insertMention", calls)[0]?.args[0]).toEqual({
      type: "date",
      value: "2026-09-30",
    });
  });

  it("inserts nothing when the dialog is cancelled", async () => {
    askDateValue.mockResolvedValue(null);
    const { calls, editor } = stubEditor();

    await runMentionCommandAsync(editor);

    expect(named("insertMention", calls)).toHaveLength(0);
    // …but the @… text is still gone, which is what the user asked for by
    // choosing the entry at all.
    expect(named("deleteRange", calls)).toHaveLength(1);
  });

  it("inserts nothing when the dialog answers empty", async () => {
    // A blank has no meaning on a surface that INSERTS — unlike a task field,
    // where clearing is a real operation.
    askDateValue.mockResolvedValue("");
    const { calls, editor } = stubEditor();

    await runMentionCommandAsync(editor);

    expect(named("insertMention", calls)).toHaveLength(0);
  });
});

describe("§316 `@` still means reference", () => {
  it("inserts a mention, never a task field, for a picked date", async () => {
    // The design is explicit: letting `@` mean a due date inside a task line
    // would make its meaning depend on context.
    askDateValue.mockResolvedValue("2026-09-30");
    const { calls, editor } = stubEditor();

    await runMentionCommandAsync(editor);

    const inserted = named("insertMention", calls)[0]?.args[0] as {
      type: string;
    };
    expect(inserted.type).toBe("date");
  });

  it("leaves the ordinary quick-date entries inserting immediately", async () => {
    const { calls, editor } = stubEditor();

    runMentionCommand({
      editor,
      props: {
        category: "date",
        id: "date-today",
        label: "Today",
        type: "date",
        value: "2026-08-31",
      },
      range: RANGE,
    });

    expect(askDateValue).not.toHaveBeenCalled();
    expect(named("insertMention", calls)[0]?.args[0]).toEqual({
      type: "date",
      value: "2026-08-31",
    });
  });
});

/** Run the picker branch and let its async continuation finish. */
async function runMentionCommandAsync(editor: Editor): Promise<void> {
  runMentionCommand({
    editor,
    props: {
      category: "date",
      id: PICK_DATE_ID,
      label: "",
      type: "date",
      value: "",
    },
    range: RANGE,
  });
  await Promise.resolve();
  await Promise.resolve();
}
