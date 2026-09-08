// The editor's floating widgets render in the app's language.
//
// §4.7 / §4.8 / §5.5 — the floating toolbar, the right-click menu, the block handle and its
// menu, the table toolbar and the table handles. Nine files, ~65 strings, five of which called
// `t()` zero times: a Korean user got English the moment they selected text.
//
// The scan is `i18n/__tests__/prose-scanner.ts`, shared with the plugin, journal and layout
// guards. Its rule: EVERY string in a scanned file is suspect, and a string is dismissed only
// by a rule that proves it is not prose. What survives is listed by name in ALLOWED below.
//
// ‼️ Unlike its three siblings this scan reads `.ts` as well as `.tsx`. That is not tidiness:
// the table and math menus are *built* in `context-menu-table.ts` and `context-menu-math.ts`,
// 30 labels that a `.tsx`-only scan cannot see. A widget, not a component, is the unit here —
// fixing only the components leaves the same menu's submenu in English. The two label tables
// that live outside this directory (`utils/contextual-ai-actions.ts`,
// `utils/toolbar/block-turn-into.ts`) hold i18n KEYS, so their guard is a resolution check in
// `i18n/__tests__/label-key-coverage.test.ts` instead.
//
// ‼️ A source scan cannot prove a label reaches the screen, so the render checks below open
// the real menus under `locale: "ko"` and require every painted label to be a value from
// ko.json. Membership, not an enumeration: an English leftover is an en.json value, never a
// ko.json one, and nothing has to be updated when a menu gains an item.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import type { Translate } from "../../../i18n/useTranslation";

import { createBaramExtensions } from "../../../extensions";
import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import { t as tr } from "../../../i18n/index";
import ko from "../../../i18n/ko.json";
import { KEYBINDING_REGISTRY } from "../../../keybindings/keybinding-registry";
import { useSettingsStore } from "../../../stores/settings/store";
import { buildMathBlockMenu, buildMathInlineMenu } from "../context-menu-math";
import { ContextMenu } from "../ContextMenu";

const DIR = "src/components/toolbar";
const KEYS = new Set(Object.keys(en));

/**
 * Literals that are neither prose nor a form worth a rule. Named one by one, so each is a
 * choice — and each on its own line with its own note, because `perfectionist/sort-sets`
 * orders this set and a comment introducing a GROUP would be left describing whatever sorted
 * into its place.
 *
 * Two judgments recur below.
 *
 * ‼️ The command ids are DERIVED from the registry, not listed. They are the one shape a
 * blanket "looks like a dotted identifier" rule must not dismiss: `commandLabel()` falls back
 * to the id itself when no entry matches, so a typo would paint a button `formatting.bolds`
 * and nothing else in the suite would notice. Deriving the dismissal from the registry makes
 * this scan that guard — a real id is not prose, a typo is still reported.
 *
 * ‼️ The two §11.2.3 `convert-lang` presets are NOT translated on purpose: a preset is both
 * what the user reads and the value substituted into the prompt sent to the model, and a
 * programming language's name is that value in either locale. (`JavaScript` and `TypeScript`
 * are in the same list, dismissed by the scanner's DOM-key shape rule instead.)
 *
 * The single letters and pairs are button glyphs. Korean chrome keeps them as they are, so
 * they are named rather than dismissed by a "one or two capitals" pattern — which would also
 * swallow a genuine one-word label like `Install`.
 */
const ALLOWED = new Set([
  ...KEYBINDING_REGISTRY.map((entry) => entry.id),
  ":scope > thead > tr, :scope > tbody > tr, :scope > tr", // CSS selector
  "[data-editor-scroll]", // attribute selector
  "[data-type='mathInline']", // attribute selector
  "[data-type]", // attribute selector
  "B", // glyph: bold
  "H", // glyph: highlight
  "H1", // glyph: heading 1
  "H2", // glyph: heading 2
  "I", // glyph: italic
  "Lk", // glyph: link
  "OL", // glyph: ordered list
  "Python", // convert-lang preset — a value sent to the model
  "Q", // glyph: blockquote
  "Rust", // convert-lang preset — a value sent to the model
  "S", // glyph: strikethrough
  "table-select-handle table-select-handle-", // className prefix
  "UL", // glyph: unordered list
  "X²", // glyph: superscript
  "X₂", // glyph: subscript
]);

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
  .map((name) => `${DIR}/${name}`);

const KO_VALUES = new Set(Object.values(ko as Record<string, string>));

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  useSettingsStore.setState({ locale: "en" });
});

describe("no toolbar widget hardcodes user-facing English", () => {
  // Without this the `it.each` below is vacuous: an empty file list passes every assertion.
  it("scanned the toolbar widgets, .ts builders included", () => {
    expect(files.length).toBeGreaterThanOrEqual(18);
    expect(files).toContain(`${DIR}/context-menu-table.ts`);
    expect(files).toContain(`${DIR}/context-menu-math.ts`);
  });

  it.each(files)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

describe("the right-click menus paint the app's locale", () => {
  it.each([
    ["the text menu", textDoc, textPos, 8, "menu.insert.bold"],
    [
      "the table cell menu",
      tableDoc,
      tableCellTextPos,
      18,
      "tableMenu.addRowAbove",
    ],
  ] as const)("%s", async (_name, build, findPos, floor, identity) => {
    useSettingsStore.setState({ locale: "ko" });
    const labels = await openMenu(build, findPos, floor, identity);

    // Every label must be a string ko.json actually holds. The alignment rows append a ✓ to
    // mark the current value, which is markup rather than prose — stripped, not listed.
    const stray = labels
      .map((label) => label.replace(/ ✓$/, ""))
      .filter((label) => !KO_VALUES.has(label));
    expect(stray).toEqual([]);
  });
});

describe("the math node menus", () => {
  // ‼️ Built directly, NOT through a right-click, and that is a statement about the app rather
  // than a shortcut. `ContextMenu.findSpecialNode` recognises a math node by `data-type`, and
  // neither React NodeView renders one (`math-block-view.tsx`, `math-inline-view.tsx` — their
  // wrappers carry `data-math-size` only; `data-type` is set in `renderHTML`, the
  // serialization path). Measured: a right-click on `.math-block-katex`, `.math-block` or the
  // renderer wrapper all open the GENERIC TEXT menu — `Cut / Copy / Paste / Bold / Italic /
  // Strikethrough / Inline Code` over an atom, exactly the issue-521 defect class. So these
  // two builders have no reachable call site to drive, and giving them one is a behaviour
  // change that does not belong in a translation branch. What is checked here is the half this
  // branch owns: the labels resolve to the catalogue rather than sitting in English.
  it.each(["en", "ko"] as const)(
    "resolve every label in %s",
    async (locale) => {
      const values = new Set(
        Object.values((locale === "en" ? en : ko) as Record<string, string>),
      );
      const t: Translate = (key, params) => tr(key, locale, params);
      const editor = new Editor({ extensions: createBaramExtensions() });
      editors.push(editor);
      render(<EditorContent editor={editor} />);
      await act(async () => {
        editor.commands.setContent(mathDoc());
        await Promise.resolve();
      });

      const labels = [
        ...buildMathBlockMenu(editor, 0, t),
        ...buildMathInlineMenu(editor, inlineMathTarget(editor), t),
      ]
        .filter((item) => !item.separator)
        .map((item) => item.label.replace(/ ✓$/, ""));

      // 7 per builder — a returned `[]` (the shape `buildMathInlineMenu` uses for "not my node")
      // would otherwise satisfy "nothing is English".
      expect(labels.length).toBe(14);
      expect(labels.filter((label) => !values.has(label))).toEqual([]);
    },
  );
});

/**
 * The inline math node's rendered element, tagged the way `buildMathInlineMenu` looks it up.
 *
 * ‼️ The tagging is the test paying for the gap the comment above describes: the builder finds
 * its node with `closest("[data-type='mathInline']")` and the NodeView renders no such
 * attribute, so nothing in the live DOM satisfies it. Setting it here keeps the fixture honest
 * about *why* — remove the attribute and the builder returns `[]`, which is exactly what a
 * right-click gets today.
 */
function inlineMathTarget(editor: Editor): HTMLElement {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (pos < 0 && node.type.name === "mathInline") pos = at;
    return pos < 0;
  });
  if (pos < 0) throw new Error("no mathInline in the fixture");
  const dom = editor.view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement))
    throw new Error("mathInline rendered no element");
  dom.setAttribute("data-type", "mathInline");
  return dom;
}

function mathDoc() {
  return {
    content: [
      { attrs: { formula: "x^2" }, type: "mathBlock" },
      {
        content: [{ attrs: { formula: "y" }, type: "mathInline" }],
        type: "paragraph",
      },
    ],
    type: "doc",
  };
}

/**
 * Right-click inside the first block and return the menu's item labels.
 *
 * `posAtCoords` is spied rather than polyfilled: jsdom has no layout, so ProseMirror maps
 * every coordinate to null and the menu would never open (the precedent is
 * `context-menu-diagram-target-routing.test.tsx`).
 */
async function openMenu(
  build: () => Record<string, unknown>,
  findPos: (editor: Editor) => number,
  floor: number,
  identity: string,
): Promise<string[]> {
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  render(
    <>
      <EditorContent editor={editor} />
      <ContextMenu editor={editor} />
    </>,
  );
  await act(async () => {
    editor.commands.setContent(build());
    await Promise.resolve();
  });

  const pos = findPos(editor);
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: pos, pos });

  await act(async () => {
    fireEvent.contextMenu(editor.view.dom.firstElementChild ?? editor.view.dom);
    await Promise.resolve();
  });

  const labels = [
    ...document.querySelectorAll(".context-menu .context-menu-item"),
  ].map((el) => el.textContent?.trim() ?? "");
  // A menu that failed to open renders nothing, and "no label is English" would be true of it.
  // The count alone is not enough: the table menu prepends the text menu's three items, so a
  // fixture that missed the cell would still look plausible. `identity` is a label only THIS
  // menu has, read from the catalogue rather than spelled out.
  expect(labels.length).toBe(floor);
  expect(labels).toContain((ko as Record<string, string>)[identity]);
  return labels;
}

/** Inside the first cell's paragraph — derived, so a schema change does not aim this at prose. */
function tableCellTextPos(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "tableCell") found = pos + 2;
    return found < 0;
  });
  if (found < 0) throw new Error("no tableCell in the fixture");
  return found;
}

function tableDoc() {
  const cell = (text: string) => ({
    content: [{ content: [{ text, type: "text" }], type: "paragraph" }],
    type: "tableCell",
  });
  return {
    content: [
      {
        content: [
          { content: [cell("a"), cell("b")], type: "tableRow" },
          { content: [cell("c"), cell("d")], type: "tableRow" },
        ],
        type: "table",
      },
      { type: "paragraph" },
    ],
    type: "doc",
  };
}

function textDoc() {
  return {
    content: [
      { content: [{ text: "hello", type: "text" }], type: "paragraph" },
    ],
    type: "doc",
  };
}

function textPos(): number {
  return 1;
}
