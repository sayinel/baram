import type { TiptapPluginContext } from "../editor-surfaces";

import { renderHook } from "@testing-library/react";
import { Plugin } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test } from "vitest";

import { useEditorSurface } from "../../hooks/use-editor-surface";
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
