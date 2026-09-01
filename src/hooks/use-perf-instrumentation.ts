// §perf-large-file C3.0/C3.1/C4 — dev-only performance instrumentation:
// installs the perf trace and binds the per-plugin transaction cost tracker
// to whichever editor is currently active.
import { useEffect } from "react";

import type { Editor } from "@tiptap/react";

import { initPerfTrace, instrumentEditor } from "../utils/editor/perf-trace";

export function usePerfInstrumentation(activeEditor: Editor | null): void {
  // §perf-large-file C3.0: Install dev-only performance instrumentation
  useEffect(() => {
    if (import.meta.env.DEV) initPerfTrace();
  }, []);

  // §perf-large-file C3.1/C4: Install per-plugin transaction cost instrumentation
  // on the ACTIVE editor — the keep-alive editor that renders large docs is a
  // separate instance, so instrumenting only the shared `editor` left its
  // txBreakdown reading 0. instrumentEditor is idempotent per instance (WeakSet),
  // so re-binding on activeEditor change instruments each editor exactly once.
  useEffect(() => {
    if (activeEditor) instrumentEditor(activeEditor);
    // §perf-large-file C4: expose the ACTIVE editor on window in DEV so perf
    // experiments can be driven from the DevTools console (e.g. fold-all to
    // simulate windowing, read doc size, dispatch commands).
    if (import.meta.env.DEV) {
      (globalThis as { __baramEditor?: unknown }).__baramEditor = activeEditor;
    }
  }, [activeEditor]);
}
