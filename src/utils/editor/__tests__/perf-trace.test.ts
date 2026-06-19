// §perf-large-file C3.0/C3.1: Tests for perf-trace utilities (jsdom-safe subset)
import { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import {
  _resetInstrumentationForTest,
  initPerfTrace,
  instrumentEditor,
  percentile,
  RingBuffer,
} from "../perf-trace";

// ---------------------------------------------------------------------------
// RingBuffer
// ---------------------------------------------------------------------------

describe("RingBuffer", () => {
  it("stores fewer entries than capacity", () => {
    const rb = new RingBuffer(10);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it("overwrites oldest entry when full", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.push(3);
    rb.push(4); // evicts 1
    expect(rb.size).toBe(3);
    expect(rb.toArray()).toEqual([2, 3, 4]);
  });

  it("wraps around correctly across multiple overwrites", () => {
    const rb = new RingBuffer(3);
    for (let i = 1; i <= 7; i++) rb.push(i);
    // Last 3 pushed: 5, 6, 7
    expect(rb.toArray()).toEqual([5, 6, 7]);
  });

  it("returns empty array when empty", () => {
    const rb = new RingBuffer(5);
    expect(rb.toArray()).toEqual([]);
    expect(rb.size).toBe(0);
  });

  it("reset clears all entries", () => {
    const rb = new RingBuffer(5);
    rb.push(10);
    rb.push(20);
    rb.reset();
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it("allows pushing after reset", () => {
    const rb = new RingBuffer(3);
    rb.push(1);
    rb.push(2);
    rb.reset();
    rb.push(99);
    expect(rb.size).toBe(1);
    expect(rb.toArray()).toEqual([99]);
  });
});

// ---------------------------------------------------------------------------
// percentile — pure function
// ---------------------------------------------------------------------------

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns the single value for a 1-element array", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it("computes p50 correctly (median)", () => {
    // [1,2,3,4,5] sorted — p50 = ceil(0.5*5)=3rd element = 3
    expect(percentile([3, 1, 4, 1, 5], 50)).toBe(3);
  });

  it("computes p99 correctly on 200-entry dataset", () => {
    // samples 1..200; p99 = ceil(0.99*200)=198th = 198
    const samples = Array.from({ length: 200 }, (_, i) => i + 1);
    expect(percentile(samples, 99)).toBe(198);
  });

  it("computes p50 / p99 on known latency samples", () => {
    // 10 samples: 5ms each except last two are 100ms and 200ms
    const samples = [5, 5, 5, 5, 5, 5, 5, 5, 100, 200];
    // sorted: [5,5,5,5,5,5,5,5,100,200]
    // p50: ceil(0.5*10)=5 → index 4 → 5
    expect(percentile(samples, 50)).toBe(5);
    // p99: ceil(0.99*10)=10 → index 9 → 200
    expect(percentile(samples, 99)).toBe(200);
  });

  it("handles unsorted input", () => {
    expect(percentile([10, 2, 8, 4, 6], 50)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// logCacheEvent — verify it is a no-op in non-DEV (import.meta.env.DEV=false)
// ---------------------------------------------------------------------------
// In Vitest, import.meta.env.DEV is true by default. We test the guard
// indirectly by verifying logCacheEvent does not throw and produces no error.
describe("logCacheEvent", () => {
  it("does not throw when called", async () => {
    const { logCacheEvent } = await import("../perf-trace");
    expect(() => logCacheEvent("set", "tab-1", 42)).not.toThrow();
    expect(() => logCacheEvent("hit", "tab-2")).not.toThrow();
    expect(() => logCacheEvent("miss", "tab-3")).not.toThrow();
    expect(() => logCacheEvent("delete", "tab-4")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// instrumentEditor — §perf-large-file C3.1
// ---------------------------------------------------------------------------
// In Vitest, import.meta.env.DEV is true, so instrumentEditor is active.
// We create a real Editor, instrument it, dispatch a transaction, and verify
// the per-plugin and per-event accumulators are populated via
// window.__baramPerf.txBreakdown() (initPerfTrace installs it on window).
describe("instrumentEditor", () => {
  // initPerfTrace installs window.__baramPerf; the module-level `installed`
  // flag makes it idempotent, so calling it once before each test is safe.
  beforeEach(() => {
    _resetInstrumentationForTest();
    initPerfTrace();
  });

  afterEach(() => {
    _resetInstrumentationForTest();
  });

  it("txBreakdown.transactions.count increments after dispatch", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>test</p>",
    });
    instrumentEditor(editor);

    editor.commands.insertContent("!");

    const breakdown = window.__baramPerf!.txBreakdown();
    expect(breakdown.transactions.count).toBeGreaterThanOrEqual(1);

    editor.destroy();
  });

  it("txBreakdown.plugins is non-empty and sorted by totalMs desc", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>a</p>",
    });
    instrumentEditor(editor);
    editor.commands.insertContent("b");

    const { plugins } = window.__baramPerf!.txBreakdown();
    expect(plugins.length).toBeGreaterThan(0);

    // Verify sort order
    for (let i = 1; i < plugins.length; i++) {
      expect(plugins[i - 1].totalMs).toBeGreaterThanOrEqual(plugins[i].totalMs);
    }

    // Verify shape of entries
    const first = plugins[0];
    expect(typeof first.name).toBe("string");
    expect(first.name.length).toBeGreaterThan(0);
    expect(typeof first.totalMs).toBe("number");
    expect(typeof first.maxMs).toBe("number");
    expect(typeof first.calls).toBe("number");
    expect(first.calls).toBeGreaterThanOrEqual(1);

    editor.destroy();
  });

  it("txBreakdown.events contains 'transaction' after dispatch", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>hello</p>",
    });
    instrumentEditor(editor);

    // tiptap emits "transaction" on every dispatched transaction
    editor.commands.insertContent(" world");

    const { events } = window.__baramPerf!.txBreakdown();
    expect(events.length).toBeGreaterThan(0);

    const txEvent = events.find((e) => e.name === "transaction");
    expect(txEvent).toBeDefined();
    expect(txEvent!.calls).toBeGreaterThanOrEqual(1);

    editor.destroy();
  });

  // §perf-large-file C3.1c: reset() must clear txBreakdown accumulators.
  // Previously pluginCosts.clear() orphaned closed-over cost refs so maxMs
  // persisted across reset calls in the live console.
  it("reset() clears txBreakdown transactions count and maxMs", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>reset test</p>",
    });
    instrumentEditor(editor);

    // Dispatch at least one transaction to populate accumulators
    editor.commands.insertContent("!");

    // Verify something was recorded
    const before = window.__baramPerf!.txBreakdown();
    expect(before.transactions.count).toBeGreaterThanOrEqual(1);

    // Reset and verify all transaction accumulators are zeroed
    window.__baramPerf!.reset();

    const after = window.__baramPerf!.txBreakdown();
    expect(after.transactions.count).toBe(0);
    expect(after.transactions.maxMs).toBe(0);
    expect(after.transactions.totalMs).toBe(0);
    expect(after.transactions.docChangedCount).toBe(0);

    // Plugin accumulators should also be zeroed (not orphaned)
    for (const plugin of after.plugins) {
      expect(plugin.calls).toBe(0);
      expect(plugin.totalMs).toBe(0);
      expect(plugin.maxMs).toBe(0);
    }

    editor.destroy();
  });

  // §perf-large-file C4: instrumentation must be PER editor instance. The old
  // single module-level boolean instrumented only the first editor, so the
  // large-doc keep-alive editor (a separate instance) reported txBreakdown=0.
  it("instruments a SECOND, distinct editor instance (R9 regression)", () => {
    const shared = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>shared</p>",
    });
    const keepAlive = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>keepalive</p>",
    });
    // Instrument the shared editor first (as App historically did), then a
    // second distinct instance (the keep-alive editor in production).
    instrumentEditor(shared);
    instrumentEditor(keepAlive);

    // Clear counters, then dispatch ONLY on the second editor.
    window.__baramPerf!.reset();
    keepAlive.commands.insertContent("!");

    // Pre-fix (single global boolean) the second editor was never patched →
    // count stayed 0. Post-fix it must be instrumented.
    expect(
      window.__baramPerf!.txBreakdown().transactions.count,
    ).toBeGreaterThanOrEqual(1);

    shared.destroy();
    keepAlive.destroy();
  });

  // §perf-large-file C4: view.updateState(EditorState.create({plugins})) builds
  // a NEW config.fields array, dropping the field.apply patch. The dispatch
  // wrapper must re-patch the live config so per-plugin breakdown survives —
  // otherwise large-doc typing reports plugins all-zero (the observed bug).
  it("per-plugin breakdown survives a config replacement (updateState) — R-config", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>a</p>",
    });
    instrumentEditor(editor);

    // Replace the config exactly like the large-doc load path does.
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        plugins: editor.state.plugins,
      }),
    );

    window.__baramPerf!.reset();
    editor.commands.insertContent("b");

    const { plugins } = window.__baramPerf!.txBreakdown();
    // Pre-fix this was all-zero because the patched config was discarded.
    expect(plugins.some((p) => p.calls > 0)).toBe(true);

    editor.destroy();
  });

  it("is idempotent per instance — re-instrumenting the same editor does not double-count", () => {
    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>x</p>",
    });
    instrumentEditor(editor);

    window.__baramPerf!.reset();
    editor.commands.insertContent("1");
    const once = window.__baramPerf!.txBreakdown().transactions.count;

    // Re-instrument the SAME instance — must be a no-op (WeakSet guard), so the
    // identical edit produces the same transaction count, not double.
    instrumentEditor(editor);
    window.__baramPerf!.reset();
    editor.commands.insertContent("2");
    const afterReinstrument =
      window.__baramPerf!.txBreakdown().transactions.count;

    expect(afterReinstrument).toBe(once);

    editor.destroy();
  });
});
