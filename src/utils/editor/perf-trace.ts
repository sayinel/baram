// §perf-large-file C3.0: Steady-state instrumentation — dev-only, no-op in prod.
// `timePhase` already lives in src/utils/perf.ts; re-export it so callers in
// the editor layer can import everything from one place.
export { timePhase } from "../perf";

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
// Public instrumentation API exposed on window (dev only)
// ---------------------------------------------------------------------------

interface BaramPerfApi {
  inputLatency: () => { max: number; n: number; p50: number; p99: number };
  longTasks: () => { count: number; totalMs: number };
  reset: () => void;
}

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
    },
  };
}
