// Order-contract pin for use-editor-features.ts (Tier-3 §4.2 App.tsx split).
//
// Rendering App itself to observe hook-call order isn't practical here, so
// instead this pins use-editor-features's OWN contract in isolation: it must
// call its 13 subsystem hooks in the documented order (skills mode → auto-save
// → journal cursor → file watcher → task watcher → capture shortcut →
// auto-snapshot → zoom → external drop → ghost text → inline AI → settings
// effects → close guard). Per CLAUDE.md's regression-test convention, this is
// pinned by call order/count, not timing — each subsystem hook is
// module-mocked with a spy that records its name into a shared array.
//
// MIGRATION GUARD: this array is the historical total order carried over from
// the App.tsx split campaign, not a claim that every position is load-bearing.
// An intentional reordering of these 13 hooks is fine — update the expected
// array to match. The one exception is `useAutoSave`, which must stay the
// FIRST hook after `useSkillsMode` (i.e. immediately after entry) because of a
// causal edge this test cannot see by itself: in App.tsx, `usePerfInstrumentation
// (activeEditor)` runs and binds the active editor to the instrumentation
// layer BEFORE `useEditorFeatures(activeEditor)` is called at all. `useAutoSave`
// is the first subsystem hook here to attach `editor.on("update")` — if it ran
// before instrumentation had bound the editor (i.e. if App.tsx called
// `useEditorFeatures` before `usePerfInstrumentation`, or if `useAutoSave` moved
// later behind another hook that swaps `editor` first), the update handler
// could fire against an editor instrumentation hasn't seen yet. Moving
// `useAutoSave` within this list is safe as long as App.tsx's own call-site
// ordering (`usePerfInstrumentation` before `useEditorFeatures`) is preserved;
// moving it relative to instrumentation's own binding is not.
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { order } = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("../use-skills-mode", () => ({
  useSkillsMode: () => {
    order.push("useSkillsMode");
    return { isSkill: false, yaml: null };
  },
}));
vi.mock("../use-auto-save", () => ({
  useAutoSave: () => {
    order.push("useAutoSave");
  },
}));
vi.mock("../use-journal-initial-cursor", () => ({
  useJournalInitialCursor: () => {
    order.push("useJournalInitialCursor");
  },
}));
vi.mock("../use-file-watcher", () => ({
  useFileWatcher: () => {
    order.push("useFileWatcher");
  },
}));
vi.mock("../use-task-watcher", () => ({
  useTaskWatcher: () => {
    order.push("useTaskWatcher");
  },
}));
vi.mock("../use-global-capture-shortcut", () => ({
  useGlobalCaptureShortcut: () => {
    order.push("useGlobalCaptureShortcut");
  },
}));
vi.mock("../use-auto-snapshot", () => ({
  useAutoSnapshot: () => {
    order.push("useAutoSnapshot");
  },
}));
vi.mock("../use-zoom", () => ({
  useZoom: () => {
    order.push("useZoom");
  },
}));
vi.mock("../use-external-drop", () => ({
  useExternalDrop: () => {
    order.push("useExternalDrop");
  },
}));
vi.mock("../use-ghost-text", () => ({
  useGhostText: () => {
    order.push("useGhostText");
  },
}));
vi.mock("../use-inline-ai", () => ({
  useInlineAI: () => {
    order.push("useInlineAI");
    return {} as import("../use-inline-ai").UseInlineAIReturn;
  },
}));
vi.mock("../use-settings-effects", () => ({
  useSettingsEffects: () => {
    order.push("useSettingsEffects");
  },
}));
vi.mock("../use-close-guard", () => ({
  useCloseGuard: () => {
    order.push("useCloseGuard");
  },
}));

import { useEditorFeatures } from "../use-editor-features";

describe("useEditorFeatures — subsystem hook call order", () => {
  it("calls its 13 subsystem hooks in the documented order", () => {
    order.length = 0;

    renderHook(() => useEditorFeatures(null));

    expect(order).toEqual([
      "useSkillsMode",
      "useAutoSave",
      "useJournalInitialCursor",
      "useFileWatcher",
      "useTaskWatcher",
      "useGlobalCaptureShortcut",
      "useAutoSnapshot",
      "useZoom",
      "useExternalDrop",
      "useGhostText",
      "useInlineAI",
      "useSettingsEffects",
      "useCloseGuard",
    ]);
  });
});
