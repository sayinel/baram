// The window chrome renders in the app's language.
//
// The chrome is the one surface a Korean user cannot avoid: the tab bar, the vault tab bar,
// the status bar and the tab switcher are on screen before any document is. They were also
// the surface with the most hardcoded English left in it — 35 strings across 8 files, found
// only when the plugins' scanner (§69 / #329) was pointed at this directory.
//
// The scan is `i18n/__tests__/prose-scanner.ts`, shared with the plugin and journal guards.
// Its rule: EVERY string in a scanned file is suspect, and a string is dismissed only by a
// rule that proves it is not prose. What survives is listed by name in ALLOWED below.
import { fireEvent, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/vault-context-loader", () => ({
  switchContext: vi.fn(async () => undefined),
}));

// jsdom has no ResizeObserver; TabBar's overflow-scroll effect constructs one.
globalThis.ResizeObserver = class {
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

import type { EditorTab } from "../../../stores/editor/editor";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { TabBar } from "../TabBar";

const DIR = "src/components/layout";
const KEYS = new Set(Object.keys(en));

/**
 * Literals that are neither prose nor a form worth a rule. Named, so each is a choice.
 *
 * ‼️ Two of these are dotted identifiers, which the scanner reports on purpose: a `t()` key
 * missing from en.json renders itself on screen, and that is the defect
 * `label-key-coverage.test.ts` exists for. A shape rule for "looks like a key" would dismiss
 * that defect too, so panel ids are named here one by one instead.
 */
const ALLOWED = new Set([
  ".context-tab:not(.context-tab--add)", // CSS selector
  '[data-tab-id="', // attribute selector prefix
  "[data-tab-id]", // attribute selector
  "ai.chatPanel", // RightPanelMode id
  "failed:", // tail of a logger template
  "file-editor-", // React key prefix
  "journal.photoGallery", // SidebarPanel id
  "Mac", // navigator.platform test
  "Promise", // `() => Promise<void>` — a type argument between two angle brackets
  "splitter splitter-", // className prefix
  "Untitled", // filename fallback: it becomes DATA (an export name, a note title), not chrome
]);

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => `${DIR}/${name}`);

describe("no layout component hardcodes user-facing English", () => {
  // Without this the `it.each` below is vacuous: an empty file list passes every assertion.
  it("scanned the layout components", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

function tab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "ctx",
    filePath: "/v/note.md",
    id: "t1",
    isDirty: false,
    isPinned: false,
    title: "note.md",
    type: "file",
    ...over,
  };
}

describe("the tab bar follows the app's locale", () => {
  beforeEach(() => {
    useUIStore.setState({ unsavedModal: null });
    useContextStore.setState({ activeContextId: "ctx", contexts: [] } as never);
    useEditorStore.setState({
      activeTabId: "t1",
      mruOrder: ["t1"],
      sourceEditedTabs: [],
      tabs: [tab()],
    });
  });

  afterEach(() => {
    useSettingsStore.setState({ locale: "en" });
  });

  /** The §38 context menu, which is where four of the nine literals lived. */
  function openContextMenu() {
    render(<TabBar />);
    const el = document.querySelector('[data-tab-id="t1"]');
    expect(el).toBeTruthy();
    fireEvent.contextMenu(el as Element);
  }

  it.each(["en", "ko"] as const)("renders the context menu in %s", (locale) => {
    useSettingsStore.setState({ locale });
    const table: Record<string, string> = locale === "en" ? en : ko;

    openContextMenu();

    // The literals, not the keys: asserting `t("tabBar.pin")` was called would pass even if
    // the lookup returned the key itself, which is exactly what a missing key renders.
    for (const key of [
      "tabBar.pin",
      "tabBar.closeOthers",
      "tabBar.closeToRight",
    ]) {
      expect(screen.getByText(table[key])).toBeTruthy();
    }
  });

  it("leaves no English in the context menu under ko", () => {
    useSettingsStore.setState({ locale: "ko" });

    openContextMenu();

    const menu = document.querySelector(".tab-context-menu");
    expect(menu).toBeTruthy();
    expect((menu as Element).textContent).not.toMatch(/[A-Za-z]{2,}/);
  });
});
