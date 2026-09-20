// §260 — the shipped Bullet Threading example, end to end on a REAL Baram editor.
//
// This is the layer every defect the repo owner found at launch would have hit: the
// manifest crossing validateManifest, the factory reached through the real registry, and
// decorations landing in the DOM of an editor built from `createBaramExtensions()`. The
// plugin's own tests (examples/plugins/bullet-threading) cover its position arithmetic
// against a minimal schema; they cannot see any of this.
//
// It loads `dist/index.mjs` — the built artifact a user actually installs, not `src/`.
import type { PluginManifest } from "../types";

import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions/index";
import { usePluginStore } from "../../stores/system/plugin";
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
  __resetEditorSurfaces();
  editor?.destroy();
  editor = undefined;
});

function makeEditor(content: string): Editor {
  editor = new Editor({ extensions: createBaramExtensions(), content });
  return editor;
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
