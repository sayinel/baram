// §260 (스펙 0050) — decorations are the main thing an editor plugin wants to draw, and
// a contributed plugin can only draw them with the HOST's prosemirror-view. That is why
// the factory is handed `ctx.pm`, for the same reason it is handed `ctx.key`: there has
// to be one identity, and the author cannot be the one to get it right.
//
// A plugin ships its own ESM bundle, so `import { DecorationSet } from "@tiptap/pm/view"`
// inside it resolves to a SECOND copy of prosemirror-view. Measured trigger — narrower
// than "two copies do not interoperate", which is what this file first assumed and the
// probe disproved:
//
//   ONE decoration source, foreign set  → renders fine. `DecorationGroup.from` hands
//                                         back the lone member, so no group forms.
//   TWO sources, one of them foreign    → `Cannot read properties of undefined
//                                         (reading 'localsInner')`, out of
//                                         prosemirror-view's own decoration walk.
//
// So a foreign set is not merely unsupported, it is a latent crash: the app's own
// extensions already contribute decorations, so a contributed plugin is never the only
// source in production, and the repo owner hit exactly this at launch.
//
// Both cases run on a REAL editor with TWO sources. A fake cannot show either — the
// failure is prosemirror-view's own, and the success is a DOM attribute it wrote.
import { Editor, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { afterEach, describe, expect, it } from "vitest";

import {
  __resetEditorSurfaces,
  addPluginContributions,
  registerEditorSurface,
} from "../editor-surfaces";

const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** Stands in for the app's own extensions, which always decorate something. */
function appSource(): Plugin {
  return decorating("app-source", Decoration, DecorationSet, "app-deco");
}

/** What a contributed factory builds out of the constructors it was handed. */
function decorating(
  name: string,
  deco: typeof Decoration,
  set: typeof DecorationSet,
  className: string,
): Plugin {
  return new Plugin({
    key: new PluginKey(name),
    props: {
      decorations: (state) =>
        set.create(state.doc, [
          deco.node(0, state.doc.firstChild?.nodeSize ?? 0, {
            class: className,
          }),
        ]),
    },
  });
}

function makeEditor(): Editor {
  editor = new Editor({
    extensions: [Document, Paragraph, Text],
    content: "<p>hello</p><p>world</p>",
  });
  return editor;
}

describe("a contributed plugin's decorations (§260)", () => {
  it("render when the set comes from the host's prosemirror-view", () => {
    const ed = makeEditor();
    ed.registerPlugin(appSource());

    expect(ed.view.dom.querySelector(".contributed")).toBeNull();

    ed.registerPlugin(
      decorating("contributed", Decoration, DecorationSet, "contributed"),
    );

    expect(ed.view.dom.querySelector(".contributed")).not.toBeNull();
    // The app's own source still draws — the two coexist in one DecorationGroup,
    // which is the arrangement the control below breaks.
    expect(ed.view.dom.querySelector(".app-deco")).not.toBeNull();
  });

  it("CONTROL: a set from a SECOND copy of prosemirror-view breaks the view", async () => {
    // A second module instance is what a plugin's own bundle is. The query suffix is how
    // to get one here — `vi.resetModules()` does not, because the re-import comes back
    // identical (measured). The inequality assertion is what makes this a control rather
    // than a re-run of the case above.
    // Through a variable: the whole point is a specifier the module graph treats as
    // new, so it is deliberately not statically resolvable and tsc must not try.
    const secondCopy = "prosemirror-view?second-copy";
    const foreign = (await import(
      /* @vite-ignore */ secondCopy
    )) as unknown as {
      Decoration: typeof Decoration;
      DecorationSet: typeof DecorationSet;
    };
    expect(foreign.DecorationSet).not.toBe(DecorationSet);

    const ed = makeEditor();
    ed.registerPlugin(appSource());

    expect(() =>
      ed.registerPlugin(
        decorating(
          "foreign",
          foreign.Decoration,
          foreign.DecorationSet,
          "foreign",
        ),
      ),
    ).toThrow(/localsInner/);
  });
});

describe("ctx.pm reaches the factory through the real registry (§260)", () => {
  afterEach(__resetEditorSurfaces);

  it("a contribution draws with ctx.pm and the decoration lands in the DOM", () => {
    const ed = makeEditor();
    ed.registerPlugin(appSource());
    registerEditorSurface(ed);

    addPluginContributions(
      "threading-probe",
      new Map([
        [
          "threads",
          (ctx) =>
            // Exactly what a plugin author writes: nothing imported from
            // prosemirror, everything taken off the context.
            new ctx.pm.Plugin({
              key: ctx.key,
              props: {
                decorations: (state) =>
                  ctx.pm.DecorationSet.create(state.doc, [
                    ctx.pm.Decoration.node(
                      0,
                      state.doc.firstChild?.nodeSize ?? 0,
                      { class: "via-ctx-pm" },
                    ),
                  ]),
              },
            }),
        ],
      ]),
      {},
    );

    expect(ed.view.dom.querySelector(".via-ctx-pm")).not.toBeNull();
    expect(ed.view.dom.querySelector(".app-deco")).not.toBeNull();
  });

  it("the constructors handed over are the host's own, not a look-alike", () => {
    const ed = makeEditor();
    registerEditorSurface(ed);
    let seen: unknown;

    addPluginContributions(
      "identity-probe",
      new Map([
        [
          "x",
          (ctx) => {
            seen = ctx.pm;
            return new ctx.pm.Plugin({ key: ctx.key });
          },
        ],
      ]),
      {},
    );

    const pm = seen as { Decoration: unknown; DecorationSet: unknown };
    // Identity, not shape: a structurally identical object from another copy is
    // precisely the failure this API exists to prevent.
    expect(pm.DecorationSet).toBe(DecorationSet);
    expect(pm.Decoration).toBe(Decoration);
    expect(Object.isFrozen(pm)).toBe(true);
  });
});
