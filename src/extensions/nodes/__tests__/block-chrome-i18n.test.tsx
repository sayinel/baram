// A block's own chrome renders in the app's language, and labels itself with the app's pill.
//
// The chrome is everything a NodeView draws that is not the document: the hover toolbar on an
// image / video / SVG / Mermaid block, the ✨ menu button on a math, code or callout block, the
// caption field, the resize edges, the empty states, the right-click menus, the fullscreen
// modals, the frontmatter tag bar. Twenty-two files; before this branch, 26 of those strings
// were hardcoded English and two were hardcoded KOREAN — an English user editing a journal
// photo read `캡션 추가...`, which is the same defect pointing the other way.
//
// Three rules are checked, and they fail for different reasons:
//
//   1. No hardcoded copy. The scan is `i18n/__tests__/prose-scanner.ts`, shared with the
//      toolbar, plugin, journal and layout guards. Its rule is inverted: EVERY string is
//      suspect and is dismissed only by a rule proving it is not prose.
//   2. Chrome copy reaches the app's PILL, not a native `title`. A `title` puts the right
//      words on screen about a second late on WebKit, which on chrome that only exists while
//      the pointer is inside the block means nobody ever reads it.
//   3. `runBlockAction`'s action name is a catalogue key. It is shown in a toast, and nothing
//      about a plain string would have told anyone it was UI.
//
// ‼️ Children are read only in `.tsx`. In a `.ts` file the scanner's `>text<` child rule
// matches TypeScript generics — `): Plugin<AtomBlockEntryState> {` reads as a JSX child — so a
// `.ts` file's children are noise, while its string literals are exactly as interesting as a
// component's. Literals in both, children in `.tsx` only.
import { render } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(),
}));

vi.mock("../../plugins/vim/vim-keys", () => ({
  updateNodeAttributesWithVim: vi.fn(),
}));

vi.mock("../../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ filePath: "/vault/notes/today.md", id: "t1" }],
    }),
  },
}));

// The chrome under test is the toolbar and the edges, not ProseMirror's plumbing — a plain div
// that forwards `ref` is enough, and `useMediaResize` needs the ref to reach a real node.
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    children,
    className,
    ref,
  }: {
    children: React.ReactNode;
    className?: string;
    ref?: React.Ref<HTMLDivElement>;
  }) => (
    <div className={className} ref={ref}>
      {children}
    </div>
  ),
}));

import type { NodeViewProps } from "@tiptap/react";

import {
  scanForNativeTitles,
  titleHitId,
} from "../../../i18n/__tests__/native-title-scan";
import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { KEYBINDING_REGISTRY } from "../../../keybindings/keybinding-registry";
import { useSettingsStore } from "../../../stores/settings/store";
import { LANGUAGE_OPTIONS } from "../code-block-languages";
import { ImageView } from "../image-view";

const DIRS = ["src/extensions/nodes", "src/extensions/nodes/views"];
const KEYS = new Set(Object.keys(en));
const KO_VALUES = new Set(Object.values(ko as Record<string, string>));

/**
 * Literals that are neither prose nor a form worth a rule. Named one by one, so each is a
 * choice — and each on its own line with its own note, because `perfectionist/sort-sets`
 * orders this set and a comment introducing a GROUP would be left describing whatever sorted
 * into its place.
 *
 * ‼️ The keybinding ids and the code-block language names are DERIVED, not listed. Both are
 * open sets that grow, and a hand-written copy would go stale silently: a new node type's
 * shortcut id or a newly supported language would be reported as prose and the fix would be to
 * add it here, which teaches the wrong thing. Deriving from the registry also makes this scan a
 * guard on the ids — a real id is not prose, a typo still gets reported.
 *
 * ‼️ Language names are NOT translated on purpose. `Rust` and `YAML` are the language's name in
 * either locale, and they are also the value written into the markdown fence, so a translated
 * label would either lie about the fence or change it.
 */
const ALLOWED = new Set([
  ...KEYBINDING_REGISTRY.map((entry) => entry.id),
  ...LANGUAGE_OPTIONS.map((option) => option.label),
  "(definitionTerm definitionDescription+)+", // PM schema content expression
  "(paragraph | heading) block*", // PM schema content expression
  "(prefers-color-scheme: dark)", // media query
  ")\\s$", // input-rule regex tail
  ".qb-builder select, .qb-builder input", // CSS selector
  "[data-vim-suspend]", // attribute selector
  "[lazy-visible] deferred mount failed", // logger, not UI
  "_at", // attr-name suffix that marks a date field
  "Alt:", // ‼️ the PROMPT the model reads, not UI — see image-view.tsx
  "AND", // <option> text identical to its own value
  "asset:", // Tauri asset protocol prefix
  "baram:search-query", // CustomEvent name
  "c++", // language alias in a detection map
  "callout callout-", // className prefix
  'div[data-type="block-embed"]', // parseHTML selector
  'div[data-type="callout"]', // parseHTML selector
  'div[data-type="footnote-definition"]', // parseHTML selector
  'div[data-type="frontmatter"]', // parseHTML selector
  'div[data-type="htmlBlock"]', // parseHTML selector
  'div[data-type="mathBlock"]', // parseHTML selector
  'div[data-type="mermaidBlock"]', // parseHTML selector
  'div[data-type="queryBlock"]', // parseHTML selector
  'div[data-type="svgBlock"]', // parseHTML selector
  'div[data-type="table-of-contents"]', // parseHTML selector
  'div[data-type="toggle"]', // parseHTML selector
  "dl.definition-list", // parseHTML selector
  "encrypted-media; picture-in-picture; fullscreen", // <iframe allow> value
  "flowchart LR&#10;  A --> B", // mermaid source in a renderHTML fallback
  "flowchart LRn  A --> B", // the same source, newline stripped
  "formatting.heading", // registry id PREFIX — the level is appended
  "html", // the block's own language chip, and the fence it writes
  "IFRAME", // a nodeName this compares against
  "img[src]", // parseHTML selector
  "INPUT", // a nodeName this compares against
  'li[data-type="taskItem"]', // parseHTML selector
  "media-resize-handle media-resize-handle-", // className prefix
  "mention mention-", // className prefix
  "mermaid", // the block's own language chip, and the fence it writes
  "Mermaid block", // runBlockAction's log prefix — deliberately locale-free
  "Mod-", // keybinding chord prefix a level is appended to
  "Mod-Alt-c", // keybinding chord
  "Mod-Enter", // keybinding chord
  "Mod-m", // keybinding chord
  "Mod-Shift-7", // keybinding chord
  "Mod-Shift-8", // keybinding chord
  "Mod-Shift-9", // keybinding chord
  "Mod-Shift-b", // keybinding chord
  "Mod-Shift-d", // keybinding chord
  "Mod-Shift-m", // keybinding chord
  "Mod-Shift-z", // keybinding chord
  "Mod-y", // keybinding chord
  "Mod-z", // keybinding chord
  "n```", // markdown fence, with its leading newline escape stripped
  "OR", // <option> text identical to its own value
  "paragraph block*", // PM schema content expression
  "Shift-Enter", // keybinding chord
  "Shift-Tab", // keybinding chord
  "Source:", // ‼️ the PROMPT the model reads, not UI — see image-view.tsx
  'span[data-type="block-reference"]', // parseHTML selector
  'span[data-type="mathInline"]', // parseHTML selector
  'span[data-type="mention"]', // parseHTML selector
  'span[data-type="tag"]', // parseHTML selector
  'span[data-type="wikilink"]', // parseHTML selector
  'sup[data-type="footnote-ref"]', // parseHTML selector
  "svg", // the block's own language chip, and the fence it writes
  "SVG block", // runBlockAction's log prefix — deliberately locale-free
  "TABLE", // a nodeName this compares against
  "table-of-contents-item table-of-contents-level-", // className prefix
  "tableColumnResizing$", // PluginKey name
  "tags:", // YAML frontmatter key this parses
  "tags: [", // the same key, inline-sequence form
  "text-align:", // CSS declaration prefix
  "Title:", // ‼️ the PROMPT the model reads, not UI — see image-view.tsx
  'ul[data-type="taskList"]', // parseHTML selector
  "VIDEO", // a nodeName this compares against
  "video[src]", // parseHTML selector
  "{{embed ((", // Logseq embed syntax this parses
  "})\\s$", // input-rule regex tail
]);

/**
 * PM schema content expressions and DOM/CSS selectors, dismissed by SHAPE.
 *
 * Local to this guard rather than added to the shared scanner: `block+` and `img[src]` are
 * things a Tiptap node module contains and the plugin/journal/layout guards do not, and a rule
 * loose enough for them ("ends in + or *") is one I am not willing to hand to a scan over
 * settings panels, where `Name *` is a plausible label.
 */
const NOT_SCHEMA = [
  /^[a-z][a-zA-Z]*[+*]$/, // block+, inline*, text*, listItem+
  /^\[[a-z-]+\]$/, // [data-vim-suspend]
];

const files = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => `${dir}/${name}`),
);

/**
 * Every native `title` this directory is still allowed to set, and how many per file.
 *
 * ‼️ A BUDGET, not a pattern — `native-title-scan.ts` explains why the value's shape cannot
 * decide this. Two reasons appear below and they are not the same reason:
 *
 *   - **The document's own words.** `![alt](src "title")` round-trips through `<img title>`,
 *     and a wikilink whose heading was truncated on screen puts the full one here. Not chrome
 *     copy at all, so the pill would be the wrong home for it — and a pill on every wikilink
 *     and image hover would be noise over content the reader is already looking at.
 *   - **The pill cannot be seen there.** The mermaid/svg fullscreen overlays and the mermaid
 *     block menu are pinned at `z-index: 9999` (mermaid.css, svg-block.css, and inline in the
 *     menu) while the pill is `--z-tooltip` = 1060 — deliberately BELOW
 *     `.plugin-consent-overlay`, see base.css. A pill there would be in the DOM, behind the
 *     modal, and untestable in jsdom. Every one of those controls carries visible text, so the
 *     native tooltip is extra explanation and losing its speed costs nothing.
 */
const NATIVE_TITLE_BUDGET = new Map<string, number>([
  // the document's own words
  ["src/extensions/nodes/image-view.tsx", 1], // <img title>
  // the pill cannot be seen there (z-index 9999)
  ["src/extensions/nodes/video-view.tsx", 2], // <iframe title>, <video title>
  ["src/extensions/nodes/views/MermaidBlockContextMenu.tsx", 3], // the disabled items' reason
  ["src/extensions/nodes/views/MermaidFullscreenModals.tsx", 1], // ditto
  ["src/extensions/nodes/views/SvgFullscreenModals.tsx", 1], // Discard, in the fullscreen editor
  ["src/extensions/nodes/wikilink-view.tsx", 1], // the un-truncated heading
]);

/** The z-index that makes the second reason above true. Asserted, not assumed. */
const MENU_Z_INDEX = 9999;

afterEach(() => {
  useSettingsStore.setState({ locale: "en" });
});

describe("no block chrome hardcodes user-facing text", () => {
  // Without this the `it.each` below is vacuous: an empty file list passes every assertion.
  it("scanned every node module and its shared views", () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
    expect(files).toContain("src/extensions/nodes/image-view.tsx");
    expect(files).toContain("src/extensions/nodes/views/MediaToolbar.tsx");
    expect(files).toContain(
      "src/extensions/nodes/views/code-block-node-view.ts",
    );
  });

  it.each(files)("%s", (file) => {
    const scan = scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED);
    const literals = scan.literals.filter(
      (value) => !NOT_SCHEMA.some((shape) => shape.test(value)),
    );
    expect({
      children: file.endsWith(".tsx") ? scan.children : [],
      literals,
    }).toEqual({ children: [], literals: [] });
  });
});

describe("chrome copy goes to the app's pill, not a native title", () => {
  // The rule itself is `i18n/__tests__/native-title-scan.ts`, shared with the toolbar guard —
  // see that file for why it is a count rather than a pattern, and for the two shapes that got
  // through the pattern versions.
  it.each(files)("%s", (file) => {
    const hits = scanForNativeTitles(file, readFileSync(file, "utf8"));
    // The budget is exact in both directions: a new native `title` fails, and so does removing
    // one without lowering the allowance.
    expect(hits.count).toBe(NATIVE_TITLE_BUDGET.get(file) ?? 0);
    // Sharper messages for the two shapes worth naming, when they do appear.
    expect(hits.literals).toEqual([]);
    expect(hits.imperative).toEqual([]);
    if (!NATIVE_TITLE_BUDGET.has(file)) {
      expect(hits.translated.map(titleHitId)).toEqual([]);
    }
  });

  it("has no budget entry for a file that no longer exists", () => {
    expect(
      [...NATIVE_TITLE_BUDGET.keys()].filter((f) => !files.includes(f)),
    ).toEqual([]);
  });
});

describe("the disabled-reason tooltip's exception still holds", () => {
  it("the mermaid menu is still stacked above the pill", () => {
    const source = readFileSync(
      "src/extensions/nodes/views/MermaidBlockContextMenu.tsx",
      "utf8",
    );
    expect(source).toContain(`zIndex: ${MENU_Z_INDEX}`);
    expect(source).toContain("title={svgTitle}");
  });
});

describe("runBlockAction names its action with a catalogue key", () => {
  // ‼️ Derived from the call sites, not a list of the keys in use. The argument is a string
  // either way, so a caller passing `"download PNG"` compiles and reaches a toast as literal
  // English — the failure this branch actually fixed.
  const sources = files
    .filter((file) => !file.endsWith("run-block-action.ts"))
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));

  const calls = sources.flatMap(({ file, source }) =>
    [...source.matchAll(/runBlockAction\(\s*"[^"]*",\s*"([^"]+)"/g)].map(
      (m) => ({ file, key: m[1] }),
    ),
  );

  // ‼️ Equality, not a floor. Prettier wraps a long call onto four lines, and a pattern that
  // reads only the single-line form would go quietly blind at exactly the call it reformatted
  // — a floor with slack in it is not a guard by the size of the slack. So the count of keys
  // extracted has to equal the count of calls that exist.
  it("parses every call site there is", () => {
    // `runBlockAction(` — with the paren, so the `import { runBlockAction }` line in each
    // consumer is not counted as a call.
    const written = sources.reduce(
      (total, { source }) =>
        total + [...source.matchAll(/\brunBlockAction\(/g)].length,
      0,
    );
    expect(written).toBeGreaterThanOrEqual(6);
    expect(calls.length).toBe(written);
  });

  it.each(calls)("$file → $key", ({ key }) => {
    expect(KEYS.has(key)).toBe(true);
  });
});

describe("an image block's chrome paints the app's locale", () => {
  // ‼️ A source scan cannot prove a label reaches the screen — the branch this guard ships with
  // found a widget whose labels resolved perfectly and whose renderer painted the raw keys. So
  // this mounts the real view under `locale: "ko"` and requires every name on screen to be a
  // value ko.json actually holds. Membership, not an enumeration: an English leftover is an
  // en.json value and never a ko.json one, and nothing here needs editing when the toolbar
  // gains a button.
  it("labels every toolbar button and resize edge from ko.json", () => {
    useSettingsStore.setState({ locale: "ko" });
    // A journal-asset path on purpose: it is the branch that renders the caption placeholder
    // (`assets/YYYY-MM/`, §56d), which is the string that was hardcoded Korean.
    const props = {
      editor: {},
      getPos: () => 0,
      node: { attrs: { alt: "", src: "assets/2026-09/photo.png", title: "" } },
      selected: false,
      updateAttributes: () => undefined,
    } as unknown as NodeViewProps;
    const { container } = render(<ImageView {...props} />);

    const named = [
      ...container.querySelectorAll<HTMLElement>("[aria-label]"),
    ].map((el) => el.getAttribute("aria-label") ?? "");

    // Three toolbar buttons and two resize edges. A floor, so a button that stops mounting is
    // a failure rather than a silently smaller set.
    expect(named.length).toBeGreaterThanOrEqual(5);
    expect(named.filter((label) => !KO_VALUES.has(label))).toEqual([]);

    // The journal-photo caption placeholder is the string that was hardcoded KOREAN, so it is
    // the one worth naming: it has to come from the catalogue in both directions.
    expect(
      container.querySelector(".image-caption-placeholder")?.textContent,
    ).toBe(ko["blockChrome.captionPlaceholder"]);
  });
});
