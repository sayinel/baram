// §260 — the shipped Bullet Threading example, end to end on a REAL Baram editor.
//
// This is the layer every defect the repo owner found at launch would have hit: the
// manifest crossing validateManifest, the factory reached through the real registry, and
// decorations landing in the DOM of an editor built from `createBaramExtensions()`. The
// plugin's own tests (examples/plugins/bullet-threading) cover its position arithmetic
// against a minimal schema; they cannot see any of this.
//
// It loads `dist/index.mjs` — the built artifact a user actually installs, not `src/`.
import { Editor } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions/index";
import {
  __resetEditorSurfaces,
  addPluginContributions,
  registerEditorSurface,
} from "../editor-surfaces";
import { validateManifest } from "../manifest";

const DIR = join(process.cwd(), "examples/plugins/bullet-threading");

interface Built {
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

  it("ships a bundle that carries no ProseMirror of its own", () => {
    // The property `ctx.pm` exists to make possible. A bundled copy is not a heavier
    // build, it is the launch crash — see contributed-decorations.test.ts.
    const bundle = readFileSync(join(DIR, "dist/index.mjs"), "utf8");
    expect(bundle).not.toMatch(/prosemirror/i);
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
