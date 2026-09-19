import type { TiptapPluginContext } from "../editor-surfaces";

import { renderHook } from "@testing-library/react";
import { Plugin } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test } from "vitest";

import {
  registerKeepaliveEditorSurface,
  useEditorSurface,
} from "../../hooks/use-editor-surface";
import {
  __resetEditorSurfaces,
  addPluginContributions,
} from "../editor-surfaces";
import { fakeEditor } from "./fake-editor";

const obedient = (ctx: TiptapPluginContext) => new Plugin({ key: ctx.key });

describe("useEditorSurface", () => {
  beforeEach(() => __resetEditorSurfaces());

  test("registers the editor while mounted", () => {
    const editor = fakeEditor();
    renderHook(() => useEditorSurface(editor as never));

    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(1);
  });

  test("unregisters on unmount, so a torn-down tab stops receiving plugins", () => {
    const editor = fakeEditor();
    const { unmount } = renderHook(() => useEditorSurface(editor as never));

    unmount();
    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(0);
  });

  test("does nothing for a null editor, which is the first render", () => {
    expect(() => renderHook(() => useEditorSurface(null))).not.toThrow();
  });
});

describe("registerKeepaliveEditorSurface", () => {
  beforeEach(() => __resetEditorSurfaces());

  test("registers the editor immediately, at construction", () => {
    const editor = fakeEditor();
    registerKeepaliveEditorSurface(editor as never);

    addPluginContributions("p1", new Map([["a", obedient]]), {});

    expect(editor.plugins).toHaveLength(1);
  });

  test("does not dispose before destroy fires", () => {
    const editor = fakeEditor();
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    registerKeepaliveEditorSurface(editor as never);

    expect(editor.plugins).toHaveLength(1);
  });

  test("disposes the surface exactly when destroy fires", () => {
    const editor = fakeEditor();
    registerKeepaliveEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});
    expect(editor.plugins).toHaveLength(1);

    editor.emit("destroy");

    // A later contribution must not reach a destroyed keep-alive editor.
    addPluginContributions("p2", new Map([["b", obedient]]), {});
    expect(editor.plugins).toHaveLength(0);
  });

  test("a second destroy is a safe no-op, not a double-dispose", () => {
    const editor = fakeEditor();
    registerKeepaliveEditorSurface(editor as never);
    addPluginContributions("p1", new Map([["a", obedient]]), {});

    editor.emit("destroy");
    expect(() => editor.emit("destroy")).not.toThrow();
    expect(editor.plugins).toHaveLength(0);
  });
});
