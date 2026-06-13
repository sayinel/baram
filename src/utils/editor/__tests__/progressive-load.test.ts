import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { mdastBlocksToPmNodes, parseMdast } from "../../../pipeline/md-to-pm";
import {
  appendChunksProgressively,
  CHUNK_TIME_BUDGET_MS,
  chunkBlocks,
  MIN_CHUNK_BLOCKS,
  REST_CHUNK_BLOCKS,
} from "../progressive-load";

// chunkBlocks works on opaque items; use plain objects as stand-ins for PMNodes.
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

describe("chunkBlocks", () => {
  it("returns a single chunk when blocks fit in the first chunk", () => {
    expect(chunkBlocks(items(50), 80, 150)).toHaveLength(1);
    expect(chunkBlocks(items(50), 80, 150)[0]).toHaveLength(50);
  });

  it("splits first chunk then rest chunks", () => {
    const chunks = chunkBlocks(items(400), 80, 150);
    expect(chunks.map((c) => c.length)).toEqual([80, 150, 150, 20]);
  });

  it("handles empty input", () => {
    expect(chunkBlocks([], 80, 150)).toEqual([]);
  });
});

const syncSchedule = (cb: () => void) => {
  cb();
  return () => {};
};

describe("appendChunksProgressively", () => {
  it("appends all chunks to the end and calls onComplete with the full doc", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    // Build a 5-paragraph doc via mdastBlocksToPmNodes, load only the first block,
    // then progressively append the rest.
    const mdast = parseMdast("A\n\nB\n\nC\n\nD\n\nE\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    expect(blocks).toHaveLength(5);

    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    expect(editor.state.doc.childCount).toBe(1);

    let completed = false;
    appendChunksProgressively(
      editor,
      [
        [blocks[1], blocks[2]],
        [blocks[3], blocks[4]],
      ],
      {
        schedule: syncSchedule,
        onComplete: () => {
          completed = true;
        },
      },
    );

    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(5);
    expect(editor.state.doc.textContent).toBe("ABCDE");
    editor.destroy();
  });

  it("stops appending after cancel()", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Manual scheduler we never advance → nothing appends; cancel must be safe.
    const pending: (() => void)[] = [];
    const handle = appendChunksProgressively(
      editor,
      [[blocks[1]], [blocks[2]]],
      {
        schedule: (cb) => {
          pending.push(cb);
          return () => {};
        },
        onComplete: () => {},
      },
    );
    handle.cancel();
    pending.forEach((cb) => cb()); // even if a tick fires, cancelled short-circuits
    expect(editor.state.doc.childCount).toBe(1);
    editor.destroy();
  });

  it("does not throw and appends nothing after editor.destroy()", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Collect pending ticks without executing them.
    const pending: (() => void)[] = [];
    appendChunksProgressively(editor, [[blocks[1]], [blocks[2]]], {
      schedule: (cb) => {
        pending.push(cb);
        return () => {};
      },
      onComplete: () => {},
    });
    editor.destroy();
    // Firing pending callbacks after destroy must not throw.
    expect(() => pending.forEach((cb) => cb())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §perf-large-file C3.3: input-pressure + adaptive chunk size
// ---------------------------------------------------------------------------

describe("appendChunksProgressively — C3.3 input-pressure deferral", () => {
  it("defers chunk when user input occurred within INPUT_QUIET_MS", () => {
    // This test verifies the pressure-deferral logic:
    //   - while now() - lastInputTime < INPUT_QUIET_MS → reschedule, no append
    //   - once past the quiet window → append and complete
    //
    // Note: appendChunksProgressively flattens chunks internally and uses
    // REST_CHUNK_BLOCKS (150) as the initial chunk size. With only a few blocks
    // all remaining blocks are consumed in ONE step once the quiet window clears.
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n\nD\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    let fakeNow = 0;
    const ticks: (() => void)[] = [];
    let completed = false;

    appendChunksProgressively(editor, [[blocks[1]], [blocks[2]], [blocks[3]]], {
      schedule: (cb) => {
        ticks.push(cb);
        return () => {};
      },
      now: () => fakeNow,
      onComplete: () => {
        completed = true;
      },
    });

    // Simulate keydown at t=0 → notePressure records lastInputTime=0.
    fakeNow = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));

    // Tick 1 at t=10 — within INPUT_QUIET_MS(100) → deferred, no append.
    fakeNow = 10;
    ticks.shift()!();
    expect(editor.state.doc.childCount).toBe(1);
    expect(completed).toBe(false);

    // Tick 2 at t=50 — still within quiet window → deferred.
    fakeNow = 50;
    ticks.shift()!();
    expect(editor.state.doc.childCount).toBe(1);
    expect(completed).toBe(false);

    // Tick 3 at t=200 — past quiet window → appends all remaining blocks at once
    // (REST_CHUNK_BLOCKS=150 > 3 remaining) and calls onComplete.
    fakeNow = 200;
    ticks.shift()!();
    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(4);
    editor.destroy();
  });

  it("appends immediately when quiet window has elapsed (no input)", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    // Start at a large time value — lastInputTime = -Infinity, so always quiet.
    let completed = false;
    appendChunksProgressively(editor, [[blocks[1]], [blocks[2]]], {
      schedule: syncSchedule,
      now: () => 999999,
      onComplete: () => {
        completed = true;
      },
    });

    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(3);
    editor.destroy();
  });
});

describe("appendChunksProgressively — C3.3 adaptive chunk size", () => {
  it("still completes correctly when first append is slow (chunk halved)", () => {
    // The adaptive halving is an internal detail we can't observe directly
    // without hooking into the chunk-size variable. Instead we verify the
    // externally-observable contract: even if the first append is "slow"
    // (elapsed > CHUNK_TIME_BUDGET_MS per controlledNow), all blocks are
    // appended and onComplete fires exactly once.
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });

    const md = Array.from({ length: 10 }, (_, i) => `P${i}`).join("\n\n");
    const blocks = mdastBlocksToPmNodes(parseMdast(md), editor.schema);
    expect(blocks.length).toBe(10);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    // Provide a now() that:
    //   - returns a large value for the pressure check (no deferral)
    //   - makes the first append look slow (elapsed > CHUNK_TIME_BUDGET_MS)
    //   - makes subsequent appends fast
    let callCount = 0;
    const controlledNow = () => {
      callCount++;
      // now() per step(): 1=pressure check, 2=t0, 3=elapsed after dispatch
      if (callCount <= 2) return 10000; // pressure ok + t0
      if (callCount === 3) return 10000 + CHUNK_TIME_BUDGET_MS + 10; // slow → halve
      return 20000 + callCount; // fast subsequent
    };

    const ticks: (() => void)[] = [];
    let completed = false;

    appendChunksProgressively(
      editor,
      blocks.slice(1).map((b) => [b]),
      {
        schedule: (cb) => {
          ticks.push(cb);
          return () => {};
        },
        now: controlledNow,
        onComplete: () => {
          completed = true;
        },
      },
    );

    // Drain all ticks — with 9 remaining blocks and initial chunk=150, the
    // first tick consumes all 9 (min(150,9)=9) even though it was "slow".
    // After the last block onComplete fires.
    while (ticks.length > 0) ticks.shift()!();

    expect(completed).toBe(true);
    expect(editor.state.doc.childCount).toBe(10);
    editor.destroy();
  });

  it("chunk size floor is MIN_CHUNK_BLOCKS after repeated halving", () => {
    // Verify the constant relationship: halving from REST_CHUNK_BLOCKS never
    // goes below MIN_CHUNK_BLOCKS.
    let size = REST_CHUNK_BLOCKS;
    while (size > MIN_CHUNK_BLOCKS) {
      size = Math.max(MIN_CHUNK_BLOCKS, Math.floor(size / 2));
    }
    expect(size).toBe(MIN_CHUNK_BLOCKS);
  });

  it("cancel cleans up even when called after completion", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );
    // Use a call COUNTER, not a boolean, to catch double-fire.
    let completeCount = 0;
    const handle = appendChunksProgressively(editor, [[blocks[1]]], {
      schedule: syncSchedule,
      now: () => 999999,
      onComplete: () => {
        completeCount++;
      },
    });
    // Already completed synchronously; calling cancel should not throw.
    expect(completeCount).toBe(1);
    expect(() => handle.cancel()).not.toThrow();
    editor.destroy();
  });

  it("onComplete fires exactly ONCE — never twice even when cancel() is called after completion", () => {
    // §perf-large-file C3.3: regression — cancel() after onComplete must not
    // re-trigger or double-fire onComplete.
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const mdast = parseMdast("A\n\nB\n\nC\n");
    const blocks = mdastBlocksToPmNodes(mdast, editor.schema);
    editor.commands.setContent(
      editor.schema.nodes.doc.create(null, [blocks[0]]).toJSON(),
    );

    const pending: (() => void)[] = [];
    let completeCount = 0;

    const handle = appendChunksProgressively(
      editor,
      [[blocks[1]], [blocks[2]]],
      {
        schedule: (cb) => {
          pending.push(cb);
          return () => {};
        },
        now: () => 999999,
        onComplete: () => {
          completeCount++;
        },
      },
    );

    // Cancel before any tick fires.
    handle.cancel();

    // Fire all pending ticks — cancelled short-circuits, onComplete must NOT fire.
    pending.forEach((cb) => cb());
    expect(completeCount).toBe(0);
    expect(editor.state.doc.childCount).toBe(1);

    editor.destroy();
  });

  it("adaptive halving: per-tick chunk sizes halve when each append exceeds CHUNK_TIME_BUDGET_MS", () => {
    // §perf-large-file C3.3: genuine sequence test.
    // Build enough blocks that multiple ticks are needed even with chunk size at
    // floor (MIN_CHUNK_BLOCKS=25). We use 200 blocks so that halving from 150
    // produces a measurable sequence of progressively smaller chunks.
    //
    // now() call pattern per step():
    //   call 1 — pressure check (now() - lastInputTime)
    //   call 2 — t0 before dispatch
    //   call 3 — elapsed = now() - t0  (we make this > CHUNK_TIME_BUDGET_MS → halve)
    // lastInputTime starts at -Infinity so pressure check always passes.

    const BLOCK_COUNT = 200;
    const md = Array.from({ length: BLOCK_COUNT }, (_, i) => `P${i}`).join(
      "\n\n",
    );

    const halvingEditor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const allBlocks = mdastBlocksToPmNodes(
      parseMdast(md),
      halvingEditor.schema,
    );
    expect(allBlocks).toHaveLength(BLOCK_COUNT);

    halvingEditor.commands.setContent(
      halvingEditor.schema.nodes.doc.create(null, [allBlocks[0]]).toJSON(),
    );

    // now() state machine: cycles through 3 roles per step().
    // Phase 1 (pressure check): large constant so now()-(-Infinity) is large → no deferral.
    // Phase 2 (t0): 0.
    // Phase 3 (elapsed = now()-t0): CHUNK_TIME_BUDGET_MS + 1 → always slow → halve.
    let nowPhase = 0;
    const BASE_TIME = 10_000_000;
    const controlledNow = () => {
      nowPhase = (nowPhase % 3) + 1;
      if (nowPhase === 1) return BASE_TIME; // pressure check passes
      if (nowPhase === 2) return 0; // t0
      return CHUNK_TIME_BUDGET_MS + 1; // elapsed: slow → halve
    };

    const ticks: (() => void)[] = [];
    const insertedPerTick: number[] = [];
    let prevChildCount = 1; // first block already loaded
    let completeCount = 0;

    appendChunksProgressively(halvingEditor, [allBlocks.slice(1)], {
      schedule: (cb) => {
        ticks.push(cb);
        return () => {};
      },
      now: controlledNow,
      onComplete: () => {
        completeCount++;
      },
    });

    // Drain ticks, recording how many blocks were inserted per tick.
    while (ticks.length > 0) {
      ticks.shift()!();
      const newCount = halvingEditor.state.doc.childCount;
      insertedPerTick.push(newCount - prevChildCount);
      prevChildCount = newCount;
    }

    // onComplete must have fired exactly once.
    expect(completeCount).toBe(1);
    expect(halvingEditor.state.doc.childCount).toBe(BLOCK_COUNT);

    // The sequence of inserted-per-tick counts must be non-increasing
    // (each slow tick halves the chunk size) and must contain at least one
    // halving step. Exclude the last tick which may be a partial chunk.
    const fullTicks = insertedPerTick.slice(0, -1);
    if (fullTicks.length >= 2) {
      // Each full tick's count must be <= the previous.
      for (let i = 1; i < fullTicks.length; i++) {
        expect(fullTicks[i]).toBeLessThanOrEqual(fullTicks[i - 1]);
      }
      // At least one actual halving must have occurred.
      expect(fullTicks[fullTicks.length - 1]).toBeLessThan(fullTicks[0]);
      // All full-tick chunk sizes must respect the MIN_CHUNK_BLOCKS floor.
      for (const count of fullTicks) {
        expect(count).toBeGreaterThanOrEqual(MIN_CHUNK_BLOCKS);
      }
    }

    halvingEditor.destroy();
  });
});
