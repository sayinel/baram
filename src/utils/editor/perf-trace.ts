// §perf-large-file C3.0/C3.1: Steady-state instrumentation — dev-only, no-op in prod.
// `timePhase` already lives in src/utils/perf.ts; re-export it so callers in
// the editor layer can import everything from one place.
export { timePhase } from "../perf";

// ---------------------------------------------------------------------------
// Types for instrumentEditor (§perf-large-file C3.1)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

interface BaramPerfApi {
  inputLatency: () => { max: number; n: number; p50: number; p99: number };
  longTasks: () => { count: number; totalMs: number };
  reset: () => void;
  txBreakdown: () => TxBreakdown;
}

/** Per-event accumulator for editor.emit cost. */
interface EventCost {
  calls: number;
  maxMs: number;
  name: string;
  totalMs: number;
}

/** Per-plugin accumulator for spec.state.apply cost. */
interface PluginCost {
  calls: number;
  maxMs: number;
  name: string;
  totalMs: number;
}

/** Shape of window.__baramPerf.txBreakdown() */
interface TxBreakdown {
  events: EventCost[];
  plugins: PluginCost[];
  transactions: TxStats;
}

/** Aggregated transaction-level stats. */
interface TxStats {
  count: number;
  docChangedCount: number;
  maxMs: number;
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Cache-event logger
// ---------------------------------------------------------------------------

/** Fixed-capacity ring buffer. Overwrites oldest entry when full. */
export class RingBuffer {
  readonly capacity: number;
  get size(): number {
    return this.count;
  }
  private buf: Float64Array;
  private count = 0;

  private head = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Float64Array(capacity);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  reset(): void {
    this.buf.fill(0);
    this.head = 0;
    this.count = 0;
  }

  toArray(): number[] {
    if (this.count === 0) return [];
    const out: number[] = new Array(this.count) as number[];
    for (let i = 0; i < this.count; i++) {
      out[i] =
        this.buf[(this.head - this.count + i + this.capacity) % this.capacity];
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Ring buffer + percentile helpers (pure — exported for tests)
// ---------------------------------------------------------------------------

/** Log an editorStateCache operation. No-op outside DEV. */
export function logCacheEvent(
  op: "delete" | "hit" | "miss" | "set",
  tabId: string,
  blockCount?: number,
): void {
  if (!import.meta.env.DEV) return;
  const blocks = blockCount !== undefined ? ` blocks=${blockCount}` : "";
  console.debug(`[Baram Perf] editorStateCache ${op} tab=${tabId}${blocks}`);
}

/** Compute percentile (0–100) from an unsorted array. Pure function. */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Module-level state (only populated after initPerfTrace())
// ---------------------------------------------------------------------------

const INPUT_LATENCY_CAPACITY = 200;
const inputLatencySamples = new RingBuffer(INPUT_LATENCY_CAPACITY);

let longTaskCount = 0;
let longTaskTotalMs = 0;

// ---------------------------------------------------------------------------
// Module-level accumulators for instrumentEditor (populated after call)
// ---------------------------------------------------------------------------

const pluginCosts = new Map<string, PluginCost>();
const eventCosts = new Map<string, EventCost>();
const txStats: TxStats = {
  count: 0,
  docChangedCount: 0,
  maxMs: 0,
  totalMs: 0,
};

function resetTxBreakdown(): void {
  // §perf-large-file C3.1c: reset accumulator values IN PLACE rather than
  // clearing the map. pluginCosts / eventCosts entries are closed over by the
  // patched field.apply / editor.emit functions; clearing the map orphans those
  // references so post-reset txBreakdown() would return stale or empty data.
  for (const v of pluginCosts.values()) {
    v.calls = 0;
    v.totalMs = 0;
    v.maxMs = 0;
  }
  for (const v of eventCosts.values()) {
    v.calls = 0;
    v.totalMs = 0;
    v.maxMs = 0;
  }
  txStats.count = 0;
  txStats.totalMs = 0;
  txStats.maxMs = 0;
  txStats.docChangedCount = 0;
}

// ---------------------------------------------------------------------------
// Public instrumentation API exposed on window (dev only)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __baramPerf?: BaramPerfApi;
  }
}

// ---------------------------------------------------------------------------
// Init — call once from App.tsx inside useEffect (DEV guard inside)
// ---------------------------------------------------------------------------

let installed = false;

export function initPerfTrace(): void {
  if (!import.meta.env.DEV) return;
  if (installed) return;
  installed = true;

  // Input-latency sampler: keydown → next rAF delta
  window.addEventListener(
    "keydown",
    () => {
      const t0 = performance.now();
      requestAnimationFrame(() => {
        inputLatencySamples.push(performance.now() - t0);
      });
    },
    { capture: true, passive: true },
  );

  // Long-task observer (not supported in all environments)
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount++;
        longTaskTotalMs += entry.duration;
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask not supported — silently skip
  }

  // Expose API on window for DevTools console
  window.__baramPerf = {
    inputLatency() {
      const arr = inputLatencySamples.toArray();
      return {
        n: arr.length,
        p50: percentile(arr, 50),
        p99: percentile(arr, 99),
        max: arr.length > 0 ? Math.max(...arr) : 0,
      };
    },
    longTasks() {
      return { count: longTaskCount, totalMs: longTaskTotalMs };
    },
    reset() {
      inputLatencySamples.reset();
      longTaskCount = 0;
      longTaskTotalMs = 0;
      resetTxBreakdown();
    },
    txBreakdown() {
      const plugins = [...pluginCosts.values()].sort(
        (a, b) => b.totalMs - a.totalMs,
      );
      const events = [...eventCosts.values()].sort(
        (a, b) => b.totalMs - a.totalMs,
      );
      return {
        events,
        plugins: plugins.slice(0, 15),
        transactions: { ...txStats },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// instrumentEditor — §perf-large-file C3.1
// Patches view.dispatch and editor.emit to accumulate per-plugin and
// per-event costs. DEV-only; no-op in production.
//
// DOM time approximation:
//   total ≈ pluginApply + events + DOM/NodeView updates
//   DOM ≈ total - sum(plugin apply) - sum(events)
// (ProseMirror's view.updateState handles DOM reconcile; not separately timed)
// ---------------------------------------------------------------------------

let editorInstrumented = false;

/** Reset module-level instrumentation state. Only intended for unit tests. */
export function _resetInstrumentationForTest(): void {
  editorInstrumented = false;
  resetTxBreakdown();
}

export function instrumentEditor(editor: AnyEditor): void {
  if (!import.meta.env.DEV) return;
  if (!editor || editorInstrumented) return;
  editorInstrumented = true;

  // --- 1. Patch config.fields[].apply to accumulate per-plugin costs --------
  // ProseMirror binds plugin.spec.state.apply into FieldDesc.apply at
  // configuration time, so we must patch field.apply on the live config.fields
  // array (not plugin.spec.state.apply which is already bound away).
  const fields: Array<{
    apply: (...args: unknown[]) => unknown;
    name: string;
  }> = editor.state?.config?.fields ?? [];

  for (const field of fields) {
    // Skip base fields (doc, selection, storedMarks, scrollToSelection)
    if (
      field.name === "doc" ||
      field.name === "selection" ||
      field.name === "storedMarks" ||
      field.name === "scrollToSelection"
    ) {
      continue;
    }
    const originalApply = field.apply.bind(field);
    // The plugin key string looks like "syntaxReveal$0"; strip the "$N" suffix
    // for a readable display name.
    const displayName = field.name.replace(/\$\d+$/, "");
    let acc = pluginCosts.get(displayName);
    if (!acc) {
      acc = { calls: 0, maxMs: 0, name: displayName, totalMs: 0 };
      pluginCosts.set(displayName, acc);
    }
    const cost = acc;
    field.apply = function (...args: unknown[]) {
      const t0 = performance.now();
      const result = originalApply(...args);
      const elapsed = performance.now() - t0;
      cost.totalMs += elapsed;
      cost.calls++;
      if (elapsed > cost.maxMs) cost.maxMs = elapsed;
      return result;
    };
  }

  // --- 2. Patch editor.emit to accumulate per-event costs -------------------
  // tiptap's dispatchTransaction calls this.emit("transaction"), "update", etc.
  const originalEmit = editor.emit.bind(editor) as (
    event: string,
    ...args: unknown[]
  ) => boolean;
  editor.emit = function (event: string, ...args: unknown[]): boolean {
    const t0 = performance.now();
    const result = originalEmit(event, ...args);
    const elapsed = performance.now() - t0;
    let evCost = eventCosts.get(event);
    if (!evCost) {
      evCost = { calls: 0, maxMs: 0, name: event, totalMs: 0 };
      eventCosts.set(event, evCost);
    }
    evCost.totalMs += elapsed;
    evCost.calls++;
    if (elapsed > evCost.maxMs) evCost.maxMs = elapsed;
    return result;
  };

  // --- 3. Patch view.dispatch for total transaction cost --------------------
  const view = editor.view as {
    dispatch: (tr: unknown) => void;
    state?: { doc?: { type?: unknown } };
  };
  const originalDispatch = view.dispatch.bind(view);

  view.dispatch = function (tr: unknown) {
    // Snapshot per-plugin totals before dispatch to compute per-tx top-2
    const snapBefore = new Map<string, number>();
    for (const [k, v] of pluginCosts) snapBefore.set(k, v.totalMs);

    const t0 = performance.now();
    originalDispatch(tr);
    const elapsed = performance.now() - t0;

    // Update aggregate tx stats
    const docChanged = !!(tr as { docChanged?: boolean }).docChanged;
    txStats.count++;
    txStats.totalMs += elapsed;
    if (elapsed > txStats.maxMs) txStats.maxMs = elapsed;
    if (docChanged) txStats.docChangedCount++;

    // Warn for slow transactions (>100ms) with top-2 plugin costs
    if (elapsed > 100) {
      const deltas: Array<[string, number]> = [];
      for (const [k, v] of pluginCosts) {
        const before = snapBefore.get(k) ?? 0;
        const delta = v.totalMs - before;
        if (delta > 0) deltas.push([k, delta]);
      }
      deltas.sort((a, b) => b[1] - a[1]);
      const top2 = deltas
        .slice(0, 2)
        .map(([name, ms]) => `${name}:${ms.toFixed(1)}`)
        .join(",");
      console.warn(
        `[Baram Perf] SLOW TX ${elapsed.toFixed(0)}ms docChanged=${String(docChanged)} plugins=${top2 || "none"}`,
      );
    }
  };
}
