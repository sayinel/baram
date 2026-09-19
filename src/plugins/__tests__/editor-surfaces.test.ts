import type { TiptapPluginContext } from "../editor-surfaces";

import { Plugin, PluginKey } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test } from "vitest";

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
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    addPluginContributions("p2", new Map([["b", obedient]]), {});

    removePluginContributions("p1");

    expect(editor.plugins).toHaveLength(1);
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
