// §260 — the shipped Bullet Threading example, end to end on a REAL Baram editor.
//
// This is the layer every defect the repo owner found at launch would have hit: the
// manifest crossing validateManifest, the factory reached through the real registry, and
// decorations landing in the DOM of an editor built from `createBaramExtensions()`. The
// plugin's own tests (examples/plugins/bullet-threading) cover its position arithmetic
// against a minimal schema; they cannot see any of this.
//
// It loads `dist/index.mjs` — the built artifact a user actually installs, not `src/`.
import { createElement } from "react";

import type { PluginManifest } from "../types";

import { act, cleanup, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions/index";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { usePluginStore } from "../../stores/system/plugin";
import { cssDeclarations, cssRules } from "../../styles/__tests__/css-rules";
import {
  __resetEditorSurfaces,
  addPluginContributions,
  registerEditorSurface,
} from "../editor-surfaces";
import { createExtensionContext } from "../extension-context";
import { validateManifest } from "../manifest";
import { declaredSettingsFor } from "../plugin-settings";

const DIR = join(process.cwd(), "examples/plugins/bullet-threading");

interface Built {
  activate: (ctx: unknown) => void;
  deactivate: () => void;
  /** The plugin's own fallbacks — the manifest's declared defaults are asserted against these. */
  DEFAULT_SETTINGS: Record<string, boolean | number | string>;
  Threading: (ctx: unknown) => never;
}

let built: Built;
let editor: Editor | undefined;

beforeAll(async () => {
  built = (await import(
    /* @vite-ignore */ join(DIR, "dist/index.mjs")
  )) as unknown as Built;
});

afterEach(() => {
  cleanup();
  __resetEditorSurfaces();
  editor?.destroy();
  editor = undefined;
});

function makeEditor(content: string): Editor {
  editor = new Editor({ extensions: createBaramExtensions(), content });
  return editor;
}

/**
 * A real editor showing `markdown`, the plugin threading it from the text `CARET`.
 *
 * Mounted through `<EditorContent>` because React node views exist only there: a bare
 * `new Editor` leaves an image as the inert `<span>` ProseMirror falls back to, not the
 * `div.react-renderer.node-image` wrapper the app renders and the stylesheet names. The
 * portal mounts on the tick after the transaction, hence the flush.
 */
async function threadAt(markdown: string): Promise<Editor> {
  const ed = makeEditor("<p>seed</p>");
  render(createElement(EditorContent, { editor: ed }));
  act(() => {
    ed.commands.setContent(markdownToProsemirror(markdown, ed.schema).toJSON());
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  registerEditorSurface(ed);
  addPluginContributions(
    "baram-bullet-threading",
    new Map([["threading", built.Threading]]),
    {},
  );
  let caret = -1;
  ed.state.doc.descendants((node, pos) => {
    if (caret === -1 && node.isText && node.text?.includes("CARET"))
      caret = pos + 1;
  });
  act(() => {
    ed.commands.setTextSelection(caret);
  });
  // The decorations landed — otherwise every empty expectation passes for nothing.
  expect(ed.view.dom.querySelectorAll("li.bt-thread-cursor")).toHaveLength(1);
  return ed;
}

/** Every rule of a stylesheet, its selector list split. */
function sheetRules(sheet: string): { body: string; selectors: string[] }[] {
  return [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(
    ([, selector, body]) => ({
      body,
      selectors: selector.split(",\n").map((s) => s.trim()),
    }),
  );
}

/** The one rule matching `selector`, as `sheetRules` returns it. */
function ruleWhere(
  sheet: string,
  selector: RegExp,
  body = "",
): { body: string; selectors: string[] } {
  const rules = sheetRules(sheet).filter(
    (rule) =>
      rule.body.includes(body) && rule.selectors.every((s) => selector.test(s)),
  );
  expect(rules, String(selector)).toHaveLength(1);
  return rules[0];
}

/** The rule that draws a parent's stroke from its own blocks, split into selectors. */
function parentStroke(sheet: string): { body: string; selectors: string[] } {
  return ruleWhere(
    sheet,
    / > :is\(p, \.node-image\):.*::after$/u,
    "position:absolute",
  );
}

/** What a block in an item reads as in a test's expectation. */
function label(el: Element): string {
  return el.matches(".node-image") ? "[image]" : (el.textContent ?? "");
}

/** The stylesheet the shipped bundle injects at its default settings. */
function shippedSheet(): string {
  const manifest = JSON.parse(
    readFileSync(join(DIR, "baram-plugin.json"), "utf8"),
  ) as PluginManifest;
  const sheets: string[] = [];
  const ctx = createExtensionContext(manifest, DIR);
  (ctx as unknown as { ui: unknown }).ui = {
    addStyle: (css: string) => {
      sheets.push(css);
      return { dispose: () => undefined };
    },
  };
  try {
    built.activate(ctx);
  } finally {
    built.deactivate();
    ctx.subscriptions.forEach((d) => d.dispose());
  }
  expect(sheets).toHaveLength(1);
  return sheets[0];
}

describe("the Bullet Threading example", () => {
  it("ships a manifest the app accepts", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(DIR, "baram-plugin.json"), "utf8"),
    );
    const result = validateManifest(manifest);
    if (!result.valid) {
      throw new Error(
        `manifest rejected: ${result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
    expect(result.valid).toBe(true);
  });

  it("declares settings the HOST can actually see, at the plugin's own defaults", () => {
    // ‼️ THIS MANIFEST SHIPPED THE FIELDS ONE LEVEL TOO HIGH. `settings` was a TOP-LEVEL
    // key, and `PluginManifest` has no such field — the host reads
    // `contributions.settings` (`declaredSettingsFor`). Nothing failed: `validateManifest`
    // ignores keys it does not know, so the manifest was valid, the plugin ran on its own
    // fallbacks, and the settings tab would have rendered EMPTY for anyone who installed
    // it. The test above passes either way, which is why this one exists.
    //
    // The second half is the defect that fix would have introduced on its own. The dead
    // field declared `lineWidth: 1.5` while the plugin's own default is 2, so merely
    // moving it into place would have changed the rendering — quietly, since nothing
    // compared the two. Asserted against the BUILT bundle's `DEFAULT_SETTINGS` rather
    // than a literal, so the manifest and the code cannot drift apart again.
    const manifest = JSON.parse(
      readFileSync(join(DIR, "baram-plugin.json"), "utf8"),
    ) as PluginManifest;

    const declared = declaredSettingsFor(manifest);
    expect(
      declared.map((f) => f.key).sort(),
      "the host must see every field the plugin reads",
    ).toEqual(Object.keys(built.DEFAULT_SETTINGS).sort());

    const defaults = Object.fromEntries(
      declared.map((f) => [f.key, f.default]),
    );
    expect(defaults).toEqual(built.DEFAULT_SETTINGS);
  });

  it("does not document a numeric default the code contradicts", () => {
    // The README is what the app shows on the plugin's page, so a wrong default here is
    // read by users, not just by authors — and it was wrong: it said `1.5` for the line
    // width while the code has always used 2, the same drift the manifest carried.
    //
    // Scoped to NUMBERS on purpose. They are the only defaults the README can state
    // exactly; the colour is described as "the app's accent colour" and the boolean as
    // "on", which is better prose for the reader and not something to assert against a
    // literal. A check that forced raw values into user-facing text would be trading the
    // reader's clarity for the test's convenience.
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const numeric = Object.entries(built.DEFAULT_SETTINGS).filter(
      ([, v]) => typeof v === "number",
    );
    expect(numeric.length, "no numeric setting — this test is vacuous").toBe(1);
    for (const [key, value] of numeric) {
      expect(
        readme,
        `README must state ${key}'s real default (\`${value}\`)`,
      ).toContain(`\`${value}\``);
    }
  });

  it("documents every setting under the label the app shows", () => {
    // ‼️ A THIRD instance of the same defect class, pre-empted. The manifest/README pair has
    // now drifted twice — a `lineWidth` default of 1.5 against a code default of 2, and a
    // `settings` block in a position `PluginManifest` has no field for — and both times the
    // README kept describing what the app had stopped doing.
    //
    // This one is about the LABEL, which is what a user reads in the settings pane and then
    // looks for here. §0054 renamed "Curve into each item" to "Branch into each item"
    // because the old name described a curve while the setting removes the whole horizontal
    // connector; nothing would have caught the README keeping the old name.
    const manifest = JSON.parse(
      readFileSync(join(DIR, "baram-plugin.json"), "utf8"),
    ) as PluginManifest;
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    const declared = declaredSettingsFor(manifest);
    expect(declared.length, "no declared field — this test is vacuous").toBe(5);
    for (const field of declared) {
      expect(
        readme,
        `README must name "${field.label}" — that is what the settings pane shows`,
      ).toContain(field.label);
    }
  });

  it("rebuilds its stylesheet when the user changes a setting", async () => {
    // ‼️ THE DEFECT THE OWNER REPORTED, at the layer it happened. Every other test here
    // proves a PIECE: the host delivers `settings:changed`
    // (`trusted-settings-changed.test.ts`), and `buildCss` honours each field (the plugin's
    // own suite). Neither notices if `activate` forgets to subscribe, or subscribes and
    // never re-injects — which is exactly the state the plugin shipped in, where a setting
    // only took effect after toggling the plugin off and on.
    //
    // Driven through the REAL `createExtensionContext`, so the EVENTS gate is the production
    // one: this plugin declares `settings` and not `events`, and that is the combination that
    // used to hand it a denied proxy. `ctx.ui` is stubbed below and is therefore NOT the
    // production gate — it happens to be granted in production because `UI_CAPABILITIES`
    // includes `settings`, which is worth knowing on its own: declaring `settings` also buys
    // `ui.addStyle`.
    const manifest = JSON.parse(
      readFileSync(join(DIR, "baram-plugin.json"), "utf8"),
    ) as PluginManifest;
    usePluginStore.setState({ pluginSettings: {} });
    const sheets: string[] = [];
    let disposed = 0;
    const ctx = createExtensionContext(manifest, DIR);
    // `ui.addStyle` needs a document in the real API; the stylesheet TEXT is what this is
    // about, so the capture stands in for the DOM write.
    (ctx as unknown as { ui: unknown }).ui = {
      addStyle: (css: string) => {
        sheets.push(css);
        return { dispose: () => void disposed++ };
      },
    };

    try {
      built.activate(ctx);
      expect(sheets).toHaveLength(1);
      expect(sheets[0]).toContain("--bt-width:2px");

      usePluginStore.getState().setPluginSetting(manifest.id, "lineWidth", 5);
      await new Promise((r) => globalThis.setTimeout(r, 600));

      expect(sheets, "no rebuild — activate did not subscribe").toHaveLength(2);
      expect(sheets[1]).toContain("--bt-width:5px");
      // The previous sheet goes, or two builds with identical selectors are both live and
      // the winner is decided by insertion order.
      expect(disposed).toBe(1);
    } finally {
      built.deactivate();
      ctx.subscriptions.forEach((d) => d.dispose());
      usePluginStore.setState({ pluginSettings: {} });
    }
  });

  it("ships a bundle that carries no ProseMirror of its own", () => {
    // The property `ctx.pm` exists to make possible. A bundled copy is not a heavier
    // build, it is the launch crash — see contributed-decorations.test.ts.
    //
    // ‼️ The check used to be `not.toMatch(/prosemirror/i)`, which is wider than the
    // property: §0054 added an `onlyWhenFocused` setting whose whole implementation is the
    // selector `.tiptap.ProseMirror-focused`, and a CSS CLASS NAME is not a bundled library.
    // So this names the two shapes a copy actually takes — a bare-specifier import the
    // bundler left in place, and inlined library source, which esbuild marks with the
    // `// node_modules/prosemirror-…/` banner it writes above every inlined module.
    const bundle = readFileSync(join(DIR, "dist/index.mjs"), "utf8");
    expect(bundle, "a bare prosemirror import survived bundling").not.toMatch(
      /from\s*["'](?:@tiptap\/pm|prosemirror-)/u,
    );
    expect(bundle, "prosemirror source was inlined").not.toMatch(
      /node_modules\/(?:@tiptap\/pm|prosemirror-)/u,
    );
    // …and the scan is not vacuous: esbuild does write that banner for what it DOES inline.
    expect(bundle).toContain("// src/thread.ts");
  });

  it("reads only list geometry the host's stylesheets declare", () => {
    // The thread traces the editor's indent guide through the host's own custom properties
    // (`--list-gutter`, `--list-guide-left`), each with a fallback for hosts that predate
    // it. That fallback is also what makes a RENAME silent: rename one in lists.css and
    // every test on either side stays green while the thread quietly returns to the
    // fallback and runs beside the guide. So the names the shipped bundle reads are checked
    // against what the host declares.
    const bundle = readFileSync(join(DIR, "dist/index.mjs"), "utf8");
    const read = new Set(
      [...bundle.matchAll(/var\(\s*--(list-[\w-]+)/gu)].map((m) => m[1]),
    );
    // Not vacuous: the two the thread's position is built from.
    expect([...read].sort()).toEqual(
      expect.arrayContaining(["list-gutter", "list-guide-left"]),
    );
    const declared = new Set(
      cssRules().flatMap((rule) =>
        cssDeclarations(rule.body)
          .map((d) => d.prop)
          .filter((prop) => prop.startsWith("--list-"))
          .map((prop) => prop.slice(2)),
      ),
    );
    expect([...read].filter((name) => !declared.has(name))).toEqual([]);
  });

  it("hangs the stroke under a parent's text on the rail the host builds its guide from", () => {
    // That stroke is drawn from the parent's PARAGRAPH, where `--list-guide-left` is the
    // wrong value — the host declares it on the nested list, the paragraph's sibling — so
    // the plugin restates the expression lists.css builds it from. A restatement is what
    // drifts: change the guide's formula and the stroke under the parent's text runs
    // beside the guide, while the strokes below it, which read the variable, still trace
    // it. Read from the stylesheet the shipped bundle actually emits.
    //
    // What a comparison of formulas cannot see is the geometry both sides assume: that the
    // paragraph and the nested list start at the same edge of the parent. A horizontal
    // margin on `li p` or `li ul` would move one and not the other with this still green.
    const guide = cssRules().flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter((d) => d.prop === "--list-guide-left")
        .map((d) => d.value),
    );
    expect(guide).toHaveLength(1);
    // The plugin's copy carries a fallback for hosts that predate the axis; the host's
    // does not need one.
    const withFallback = guide[0].replace(
      "var(--list-marker-axis)",
      "var(--list-marker-axis, 0.5em)",
    );
    expect(
      withFallback,
      "the host's formula no longer reads the axis",
    ).not.toBe(guide[0]);
    const left = cssDeclarations(parentStroke(shippedSheet()).body).filter(
      (d) => d.prop === "left",
    );
    expect(left.map((d) => d.value)).toEqual([withFallback]);
  });

  // Which blocks carry that stroke, on the DOM a real editor renders. The selector is the
  // shipped one, so this is the plugin's own condition read against Baram's markup — and
  // the image cases are what show `node-image` is the wrapper sitting directly in the item.
  it.each([
    ["a parent above its sub-list", "- parent\n  - CARET\n", ["parent"]],
    [
      "an image between the text and the sub-list",
      "- parent\n\n  ![](a.png)\n\n  more\n\n  - CARET\n",
      ["parent", "[image]", "more"],
    ],
    [
      "a task parent's image",
      "- [ ] task parent\n\n  ![](a.png)\n\n  - [ ] CARET\n",
      ["task parent", "[image]"],
    ],
    [
      "no image after the sub-list",
      "- parent\n\n  - CARET\n\n  ![](a.png)\n",
      ["parent"],
    ],
    [
      "every paragraph above the sub-list, none after it",
      "- first\n\n  second\n\n  - CARET\n\n  after\n",
      ["first", "second"],
    ],
    [
      "the paragraphs above a SECOND sub-list holding the caret",
      "- first\n\n  - other\n\n  between\n\n  1. CARET\n",
      ["first", "between"],
    ],
    ["a task parent", "- [ ] task parent\n  - [ ] CARET\n", ["task parent"]],
    // ‼️ The caret's list sits in a blockquote, so the parent is a rung with no direct
    // sub-list holding the thread. A stroke from its paragraphs would start at its bullet
    // and join nothing — and one from "after" would run beside text past the caret.
    [
      "no paragraph when the thread runs into a blockquote",
      "- parent\n\n  > - CARET\n\n  after\n",
      [],
    ],
    ["no paragraph of the caret's own item", "- CARET\n  - child\n", []],
  ])("strokes %s", async (_name, markdown, expected) => {
    const ed = await threadAt(markdown);
    const selector = parentStroke(shippedSheet())
      .selectors.map((s) => s.replace(/::after$/u, ""))
      .join(", ");
    const stroked = [...ed.view.dom.querySelectorAll(selector)].map(label);
    expect(stroked).toEqual(expected);
  });

  it("reaches below a sibling whose last block is an image, and no other", async () => {
    // That image's margin collapses through the sibling's bottom edge, which is the seam
    // the rule closes — so it must find such a sibling in Baram's markup, and leave alone
    // a sibling whose image is followed by more text.
    const ed = await threadAt(
      "- parent\n  - ends in an image\n\n    ![](a.png)\n\n  - image then text\n\n    ![](a.png)\n\n    text\n\n  - CARET\n",
    );
    const rule = ruleWhere(
      shippedSheet(),
      /node-image:last-child\)\)::after$/u,
    );
    expect(rule.body).toContain(
      "bottom:calc(var(--bt-gap) - var(--bt-image-gap))",
    );
    const selector = rule.selectors
      .map((s) => s.replace(/::after$/u, ""))
      .join(", ");
    expect(
      [...ed.view.dom.querySelectorAll(selector)].map(
        (li) => li.querySelector("p")?.textContent,
      ),
    ).toEqual(["ends in an image"]);
  });

  it.each([
    [
      "a sibling",
      "- parent\n  - ![](a.png)\n  - not first\n\n    ![](a.png)\n  - CARET\n",
      /li:not\(\.bt-thread\):is\(:has\(> \.node-image:is\(:first-child/u,
      "top:calc(-1 * var(--bt-image-gap))",
    ],
    [
      "the caret's item, under its elbow",
      "- parent\n  - not first\n\n    ![](a.png)\n  - ![](a.png)\n\n    CARET\n",
      /^\.tiptap li li\.bt-thread:is\(/u,
      "height:calc(var(--bt-image-gap) + ",
    ],
  ])(
    "climbs above %s whose first block is an image, and no other",
    async (_name, markdown, selector, declaration) => {
      // `- ![](a.png)` makes an item that STARTS with the image, so the image's top margin
      // collapses through the item's top and the gap above it is that margin. The rule has
      // to find that item in Baram's markup — and not one whose image comes after text.
      const ed = await threadAt(markdown);
      const rule = ruleWhere(shippedSheet(), selector, declaration);
      const matched = [
        ...ed.view.dom.querySelectorAll(
          rule.selectors.map((s) => s.replace(/::after$/u, "")).join(", "),
        ),
      ];
      expect(matched).toHaveLength(1);
      // The one it found starts with the image.
      expect(matched[0].querySelector(":scope > *:not(.fold-arrow)")).toSatisfy(
        (el: Element | null) => el?.matches(".node-image") === true,
      );
    },
  );

  it.each([
    [
      "after the rung's list",
      "- parent\n  - before\n  - CARET\n\n  1. after\n",
      ["after"],
    ],
    // The thread runs past a list BEFORE the rung's on its way down, so that one keeps
    // its segments.
    ["none before the rung's list", "- parent\n  - before\n\n  1. CARET\n", []],
  ])(
    "hides the segments of a second sub-list %s",
    async (_name, markdown, expected) => {
      // The sibling segments are drawn in every list directly in the threaded item, so a
      // second sub-list below the caret's drew a stray stroke beside its items (seen in
      // the app).
      const ed = await threadAt(markdown);
      const rule = ruleWhere(
        shippedSheet(),
        /:has\(> li\.bt-thread\) ~ :is\(ul, ol\) > li::after$/u,
      );
      expect(rule.body).toBe("border-color:transparent");
      const hidden = [
        ...ed.view.dom.querySelectorAll(
          rule.selectors.map((s) => s.replace(/::after$/u, "")).join(", "),
        ),
      ].map((li) => li.querySelector("p")?.textContent);
      expect(hidden).toEqual(expected);
    },
  );

  it("stretches the image strokes by the margin the host gives an image", () => {
    // `--bt-image-gap` restates the image node view's margin. Change that margin and every
    // stroke beside an image breaks or overshoots by the difference, with the plugin's own
    // tests still green — so the two are compared here, where both are visible.
    const margin = cssRules()
      .filter((rule) => rule.selector === ".tiptap .image-node-view")
      .flatMap((rule) => cssDeclarations(rule.body))
      .filter((d) => d.prop === "margin");
    expect(margin).toHaveLength(1);
    // `0.5em 0` — the same margin above and below, which is what one variable assumes.
    const [vertical, horizontal, bottom] = margin[0].value.trim().split(/\s+/u);
    expect(horizontal).toBe("0");
    expect(bottom).toBeUndefined();
    expect(shippedSheet()).toContain(`--bt-image-gap:${vertical};`);
  });

  it("threads the ancestor chain of the item holding the caret", () => {
    const ed = makeEditor(
      "<ul><li><p>outer</p><ul><li><p>middle</p><ul><li><p>inner</p></li></ul></li></ul></li></ul>",
    );
    registerEditorSurface(ed);
    addPluginContributions(
      "baram-bullet-threading",
      new Map([["threading", built.Threading]]),
      {},
    );

    // Caret into the innermost item.
    const pos = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n");
    expect(pos).toContain("inner");
    let innerPos = -1;
    ed.state.doc.descendants((node, p) => {
      if (innerPos === -1 && node.isText && node.text === "inner")
        innerPos = p + 1;
    });
    ed.commands.setTextSelection(innerPos);

    const threaded = ed.view.dom.querySelectorAll("li.bt-thread");
    expect(threaded).toHaveLength(3);
    // Exactly one end, and it is the innermost — a count alone would pass with the
    // ring on the wrong rung.
    const cursors = ed.view.dom.querySelectorAll("li.bt-thread-cursor");
    expect(cursors).toHaveLength(1);
    expect(cursors[0].textContent).toContain("inner");
    expect(cursors[0].querySelector("li")).toBeNull();
  });

  it("draws nothing when the caret is outside a list", () => {
    const ed = makeEditor(
      "<p>plain paragraph</p><ul><li><p>item</p></li></ul>",
    );
    registerEditorSurface(ed);
    addPluginContributions(
      "baram-bullet-threading",
      new Map([["threading", built.Threading]]),
      {},
    );
    ed.commands.setTextSelection(2);

    expect(ed.view.dom.querySelectorAll("li.bt-thread")).toHaveLength(0);
  });
});
