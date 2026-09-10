// §338 — the ✨ AI entry point disappears from all three toolbars that carry
// one when `aiEnabled` is off.
//
// TableToolbar gets a real render, via the shared fixture extracted from
// table-toolbar-overflow-toggle.test.tsx (issue 542) — a source scan only
// proves the text "Sparkles" and "aiEnabled" exist somewhere in the file, not
// that the button actually disappears. FloatingToolbar and BlockHandleMenu
// each need their own selection/pos fixture, which building here is not
// worth the render cost, so those two stay source scans; each `it` below
// says exactly what its regex constrains and the refactor that would
// silently stop matching it.
import { cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Names come from the catalogue, not from literals here.
import en from "../../../i18n/en.json";
import { useAIStore } from "../../../stores/ai/ai";
import {
  cleanupEditors,
  mountTableWithToolbar,
} from "./table-toolbar-test-helpers";

const ROOT = join(process.cwd(), "src/components/toolbar");

afterEach(() => {
  cleanup();
  cleanupEditors();
  useAIStore.setState({ aiEnabled: true }); // restore the default for other files
});

describe("TableToolbar hides its AI button when ai is off (§338, real render)", () => {
  it("removes the button and its trailing separator when aiEnabled is false", async () => {
    useAIStore.setState({ aiEnabled: false });
    const { view } = await mountTableWithToolbar();

    expect(view.queryByLabelText(en["toolbar.ai.commands"])).toBeNull();

    const toolbar = view.container.querySelector(".table-toolbar");
    // Two separators remain: before the delete-row/column group, and before
    // the (now-hidden) AI button. A dangling third — the AI button's own
    // trailing separator left outside the gate — would push this to 3.
    expect(toolbar?.querySelectorAll(".table-toolbar-separator").length).toBe(
      2,
    );
  });

  it("shows the button and all three separators when aiEnabled is true", async () => {
    useAIStore.setState({ aiEnabled: true });
    const { view } = await mountTableWithToolbar();

    expect(view.getByLabelText(en["toolbar.ai.commands"])).toBeInTheDocument();

    const toolbar = view.container.querySelector(".table-toolbar");
    expect(toolbar?.querySelectorAll(".table-toolbar-separator").length).toBe(
      3,
    );
  });
});

describe("FloatingToolbar gates its AI entry (§338, source scan)", () => {
  it("wraps the separator and the AI wrapper in one `aiEnabled && (<>...</>)` block", () => {
    const src = readFileSync(join(ROOT, "FloatingToolbar.tsx"), "utf8");
    expect(src).toContain("Sparkles");
    // Constrains: an `aiEnabled && (` immediately followed by a fragment
    // whose contents include, in order, the separator, then the ai-wrapper,
    // then Sparkles, before that fragment closes. A refactor to
    // `aiEnabled ? (<>...</>) : null` keeps the button correctly hidden but
    // has no literal `&&` before the `(`, so it would silently stop matching.
    expect(src).toMatch(
      /aiEnabled\s*&&\s*\(\s*<>[\s\S]*?floating-toolbar-separator[\s\S]*?floating-toolbar-ai-wrapper[\s\S]*?Sparkles[\s\S]*?<\/>\s*\)/,
    );
  });
});

describe("BlockHandleMenu gates its AI entry (§338, source scan)", () => {
  it("gates the real AI trigger (Sparkles/askAI) via `blockHasContent && aiEnabled &&`, not the class-sharing Turn-into trigger", () => {
    const src = readFileSync(join(ROOT, "BlockHandleMenu.tsx"), "utf8");
    expect(src).toContain("Sparkles");
    expect(src).toContain("blockMenu.askAI");
    // `block-handle-ai-trigger` is the class on BOTH the Turn-into submenu
    // (Replace/turnInto) and the real AI submenu (Sparkles/askAI) — anchoring
    // on that class would also match, and could gate, the wrong trigger.
    // `blockHasContent` is the pre-existing condition that already wraps
    // ONLY the AI submenu, so this constrains a literal `&&` between
    // `blockHasContent` and `aiEnabled` and the `(` that opens its fragment.
    // A ternary refactor (`blockHasContent && (aiEnabled ? (...) : null)`)
    // would silently stop matching for the same reason as FloatingToolbar's.
    expect(src).toMatch(/blockHasContent\s*&&\s*aiEnabled\s*&&\s*\(/);
  });
});
