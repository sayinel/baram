import type {
  PluginProseMirror,
  TiptapPluginContext,
} from "../editor-surfaces";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { logger } from "../../utils/logger";
import {
  __resetEditorSurfaces,
  addPluginContributions,
  registerEditorSurface,
  removePluginContributions,
} from "../editor-surfaces";
import { fakeEditor } from "./fake-editor";

/** A well-behaved contribution: it uses the key the host handed it. */
const obedient = (ctx: TiptapPluginContext) => new Plugin({ key: ctx.key });

describe("editor-surfaces", () => {
  beforeEach(() => __resetEditorSurfaces());

  test("installs a contribution on an already-registered surface", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);

    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(1);
  });

  test("installs already-loaded contributions on a surface registered later", () => {
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    const editor = fakeEditor();

    registerEditorSurface(editor as never);

    expect(editor.plugins).toHaveLength(1);
  });

  test("gives each surface its own plugin instance", () => {
    // A ProseMirror plugin may hold per-editor state, so one shared instance across
    // two editors would be a bug. The factory runs once per surface.
    const one = fakeEditor();
    const two = fakeEditor();
    registerEditorSurface(one as never);
    registerEditorSurface(two as never);

    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(one.plugins[0]).not.toBe(two.plugins[0]);
  });

  test("removes only the named plugin's contributions", () => {
    // Which plugin survives, not how many: a count alone passes just as happily when
    // the WRONG one was removed, which is the failure this test's name describes.
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const keyOf = new Map<string, unknown>();
    const recording = (ctx: TiptapPluginContext) => {
      keyOf.set(ctx.pluginId, ctx.key);
      return new Plugin({ key: ctx.key });
    };
    addPluginContributions("p1", new Map([["a", recording]]), {});
    addPluginContributions("p2", new Map([["b", recording]]), {});

    removePluginContributions("p1");

    expect(editor.keys()).toEqual([keyOf.get("p2")]);
  });

  test("refuses a contribution that ignores the key the host minted", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const rogue = () => new Plugin({ key: new PluginKey("fold") });

    expect(() =>
      addPluginContributions("p1", new Map([["a", rogue]]), {}),
    ).toThrow(/key/i);
  });

  test("refuses a contribution that would decide editability", () => {
    // §298 §12-⑪: only the core Editable extension and the vim plugin own
    // `view.editable`. A contributed plugin must not become a third owner.
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const suppressor = (ctx: TiptapPluginContext) =>
      new Plugin({ key: ctx.key, props: { editable: () => false } });

    expect(() =>
      addPluginContributions("p1", new Map([["a", suppressor]]), {}),
    ).toThrow(/editable/i);
  });

  test("refuses a contribution whose editable prop hides behind a once-only getter", () => {
    // `Plugin`'s constructor reads `spec.props.editable` exactly once (into the
    // instance's own `props`), so a check that re-reads `spec.props` afterwards would
    // see whatever the getter answers on ITS read — which a two-faced getter can make
    // "nothing to see here." `plugin.props.editable` already holds the one value the
    // view will actually use and cannot be fooled this way.
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const sneaky = (ctx: TiptapPluginContext) => {
      let reads = 0;
      return new Plugin({
        key: ctx.key,
        props: {
          get editable() {
            reads += 1;
            return reads === 1 ? () => false : undefined;
          },
        },
      });
    };

    expect(() =>
      addPluginContributions("p1", new Map([["a", sneaky]]), {}),
    ).toThrow(/editable/i);
  });

  test("refuses a contribution with no key at all", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const unkeyed = () => new Plugin({});

    expect(() =>
      addPluginContributions("p1", new Map([["a", unkeyed]]), {}),
    ).toThrow(/key/i);
  });

  test("installs nothing when a contribution is refused", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const rogue = () => new Plugin({ key: new PluginKey("fold") });

    try {
      addPluginContributions("p1", new Map([["a", rogue]]), {});
    } catch {
      /* expected */
    }

    expect(editor.plugins).toHaveLength(0);
  });

  test("stops installing on a surface once it is disposed", () => {
    const editor = fakeEditor();
    const dispose = registerEditorSurface(editor as never);

    dispose();
    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(0);
  });

  test("removes a surface's contributions when it is disposed", () => {
    const editor = fakeEditor();
    const dispose = registerEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});

    dispose();

    expect(editor.plugins).toHaveLength(0);
  });

  test("installs nothing on a new surface when one of its contributions fails to rebuild", () => {
    // A factory that already succeeded on one surface can still throw on the next one —
    // it re-runs per surface by design, on third-party code. The new surface must end up
    // exactly as unregistered as if `registerEditorSurface` had never been called.
    const first = fakeEditor();
    registerEditorSurface(first as never);
    let calls = 0;
    const flaky = (ctx: TiptapPluginContext) => {
      calls += 1;
      if (calls > 1) throw new Error("boom");
      return new Plugin({ key: ctx.key });
    };
    addPluginContributions("p1", new Map([["a", flaky]]), {});
    expect(first.plugins).toHaveLength(1);

    const second = fakeEditor();
    expect(() => registerEditorSurface(second as never)).toThrow(/boom/);

    expect(second.plugins).toHaveLength(0);
    // The failed surface was never actually registered, so it stays untouched by
    // later contributions too.
    addPluginContributions("p2", new Map([["b", obedient]]), {});
    expect(second.plugins).toHaveLength(0);
    expect(first.plugins).toHaveLength(2);
  });

  test("leaves no registry entry when installing a contribution throws", () => {
    // `registerPlugin` belongs to the EDITOR, not to us: a destroyed editor or a key
    // collision rejects there, after every factory has already built cleanly. Recording
    // the contribution before that call, and leaving it there, would mean every surface
    // created afterwards installs a dead plugin's contribution — which is what this case
    // reaches for, with no loader in it. The loader does unwind this throw on its own
    // (`unwindAfterActivate` → `removePluginContributions`), but `addPluginContributions`
    // is exported and owns this guarantee whoever calls it.
    const hostile = fakeEditor();
    hostile.registerPlugin = () => {
      throw new Error("editor refused");
    };
    registerEditorSurface(hostile as never);

    expect(() =>
      addPluginContributions("p1", new Map([["a", obedient]]), {}),
    ).toThrow(/refused/);

    const later = fakeEditor();
    registerEditorSurface(later as never);
    expect(later.plugins).toHaveLength(0);
  });

  test("unwinds the plugins that did land when a later one is rejected", () => {
    const editor = fakeEditor();
    const accept = editor.registerPlugin;
    let calls = 0;
    editor.registerPlugin = (plugin) => {
      calls += 1;
      if (calls > 1) throw new Error("editor refused");
      accept(plugin);
    };
    registerEditorSurface(editor as never);

    expect(() =>
      addPluginContributions(
        "p1",
        new Map([
          ["a", obedient],
          ["b", obedient],
        ]),
        {},
      ),
    ).toThrow(/refused/);

    // Half an installation is worse than none: the first plugin is live on the editor
    // with no record anyone can use to take it off again.
    expect(editor.plugins).toHaveLength(0);
  });

  test("unwinds a plugin whose own registerPlugin threw after it had landed", () => {
    // The failure the owner hit. `registerPlugin` reconfigures the state first and
    // updates the view second, so a plugin whose rendering throws is ALREADY in
    // `editor.state.plugins` when the call throws. A key recorded only once the call
    // returns is therefore never recorded at all for exactly the plugin that landed,
    // and the unwind walks past it.
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    editor.hooks.afterRegister = () => {
      throw new TypeError(
        "undefined is not an object (evaluating 'localsInner')",
      );
    };

    expect(() =>
      addPluginContributions("p1", new Map([["a", obedient]]), {}),
    ).toThrow(/localsInner/);

    expect(editor.plugins).toHaveLength(0);
  });

  test("lets the same contribution be installed again after one threw mid-registration", () => {
    // What a leaked plugin costs: the host mints one key per contribution and reuses it
    // across loads, so a plugin left on the editor makes every RETRY hand ProseMirror a
    // second instance of that key — "Adding different instances of a keyed plugin". The
    // owner saw a launch-time render failure turn into that on every load afterwards.
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    editor.hooks.afterRegister = () => {
      throw new Error("view update failed");
    };
    expect(() =>
      addPluginContributions("p1", new Map([["a", obedient]]), {}),
    ).toThrow(/view update failed/);

    editor.hooks.afterRegister = undefined;
    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(1);
  });

  test("unwinds the earlier plugins too when a later one throws after landing", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    let registered = 0;
    editor.hooks.afterRegister = () => {
      registered += 1;
      if (registered > 1) throw new Error("view update failed");
    };

    expect(() =>
      addPluginContributions(
        "p1",
        new Map([
          ["a", obedient],
          ["b", obedient],
        ]),
        {},
      ),
    ).toThrow(/view update failed/);

    expect(editor.plugins).toHaveLength(0);
  });

  test("unwinds a new surface whose registerPlugin throws after the plugin lands", () => {
    // Same defect on the other install path: `registerEditorSurface` re-runs every
    // loaded contribution on the new editor, and its unwind reads the same record.
    const editor = fakeEditor();
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    editor.hooks.afterRegister = () => {
      throw new Error("view update failed");
    };

    expect(() => registerEditorSurface(editor as never)).toThrow(
      /view update failed/,
    );

    expect(editor.plugins).toHaveLength(0);
  });

  test("keeps unwinding when one removal throws, and reports the original failure", () => {
    // `unregisterPlugin` updates the view too, on an editor that is — by definition
    // here — already failing to render. A throw from one removal must not strand the
    // rest or replace the error that explains why we are unwinding at all.
    const loud = vi.spyOn(logger, "error").mockImplementation(() => {});
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    let registered = 0;
    editor.hooks.afterRegister = () => {
      registered += 1;
      if (registered > 1) throw new Error("view update failed");
    };
    const removals: unknown[] = [];
    editor.hooks.afterUnregister = (key) => {
      removals.push(key);
      if (removals.length === 1) throw new Error("teardown boom");
    };

    expect(() =>
      addPluginContributions(
        "p1",
        new Map([
          ["a", obedient],
          ["b", obedient],
        ]),
        {},
      ),
    ).toThrow(/view update failed/);

    expect(removals).toHaveLength(2);
    expect(editor.plugins).toHaveLength(0);
    expect(loud).toHaveBeenCalled();
    loud.mockRestore();
  });

  test("re-adding the same pluginId replaces its contributions instead of duplicating them", () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    expect(editor.plugins).toHaveLength(1);

    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(1);
  });

  test("registering the same surface twice is a no-op that returns the same disposer", () => {
    const editor = fakeEditor();
    const first = registerEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    expect(editor.plugins).toHaveLength(1);

    const second = registerEditorSurface(editor as never);

    expect(second).toBe(first);
    expect(editor.plugins).toHaveLength(1);
  });
});

describe("ctx.pm is the published surface (§260)", () => {
  beforeEach(() => __resetEditorSurfaces());

  test("hands over exactly the constructors PluginProseMirror declares", () => {
    // `PluginProseMirror` in plugins/types.ts is what a plugin author's editor knows
    // about; the object handed over here is what they actually receive. They are
    // SEPARATE declarations on purpose — types.ts carries no `@tiptap` imports so the
    // generated examples/plugins/types.d.ts resolves for someone who has not installed
    // it, while this module names the real classes. That makes a constructor added here
    // and not published there a silent gap, and this is what closes it.
    //
    // The published list is a literal because TypeScript's keys are erased at runtime.
    // Adding a member to `PluginProseMirror` without adding it here reddens nothing; the
    // failure this catches is the other direction, which is the one that has a victim —
    // an author who cannot see what they were given.
    const published = ["Decoration", "DecorationSet", "Plugin", "PluginKey"];

    let handed: Record<string, unknown> | undefined;
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    addPluginContributions(
      "pm-surface",
      new Map([
        [
          "x",
          (ctx: TiptapPluginContext) => {
            handed = ctx.pm as unknown as Record<string, unknown>;
            return new Plugin({ key: ctx.key });
          },
        ],
      ]),
      {},
    );

    expect(handed).toBeDefined();
    expect(Object.keys(handed ?? {}).sort()).toEqual(published);
  });

  test("the object is frozen, so one contribution cannot swap a constructor", () => {
    // Shared by every factory on every surface; a mutation would reach the next one.
    let handed: PluginProseMirror | undefined;
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    addPluginContributions(
      "pm-frozen",
      new Map([
        [
          "x",
          (ctx: TiptapPluginContext) => {
            handed = ctx.pm;
            return new Plugin({ key: ctx.key });
          },
        ],
      ]),
      {},
    );

    expect(Object.isFrozen(handed)).toBe(true);
  });
});
