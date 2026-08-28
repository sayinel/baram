import type { PluginFileViewer } from "../../../plugins/plugin-ui-store";
// §286/§298 — pins `resolveSurfaceKind` against the three chains it replaced in `App.tsx`
// (the StatusBar mode ternary, `isMarkdownSurfaceActive`, and the render ternary). Nothing
// imports `App`, so before this file a branch added to one chain and not the others was
// invisible to the whole suite.
import type { EditorTab } from "../../../stores/editor/editor";

import { describe, expect, it } from "vitest";

import { resolveSurfaceKind } from "../surface-kind";

function tab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "ctx",
    filePath: "/vault/a.md",
    id: "t1",
    isDirty: false,
    isPinned: false,
    title: "a.md",
    ...over,
  };
}

function viewer(over: Partial<PluginFileViewer> = {}): PluginFileViewer {
  return {
    extensions: ["svg"],
    onMount: () => {},
    pluginId: "media-viewer",
    viewerId: "media-viewer:svg",
    ...over,
  };
}

const base = {
  activeTabId: "t1" as null | string,
  fileViewers: [] as PluginFileViewer[],
  isHtmlSourceView: false,
  isSourceMode: false,
  rootPath: "/vault" as null | string,
};

describe("resolveSurfaceKind — no active tab id", () => {
  it("is home when no vault is open", () => {
    expect(
      resolveSurfaceKind({
        ...base,
        activeTabId: null,
        rootPath: null,
        tab: undefined,
      }),
    ).toBe("home");
  });

  it("is empty when a vault is open but no tab", () => {
    expect(
      resolveSurfaceKind({ ...base, activeTabId: null, tab: undefined }),
    ).toBe("empty");
  });
});

describe("resolveSurfaceKind — a dangling active tab id", () => {
  // §286 A stale tab-switcher selection (or any other caller) can set `activeTabId` to an
  // id no open tab currently has. The three original chains all keyed home/empty on the id,
  // not on whether the lookup succeeded — `activeTabFilePath` was null either way, so a
  // dangling id fell through the exact same doors as a tab without a resolved file path,
  // landing on "markdown" (or "source" in source mode). This must NOT become "empty": that
  // would hide `MarkdownSurface` for a state the original code showed it in.
  it("is markdown, like a tab with no file path — not empty", () => {
    expect(
      resolveSurfaceKind({ ...base, isSourceMode: false, tab: undefined }),
    ).toBe("markdown");
  });

  it("is source when source mode is on, like a tab with no file path", () => {
    expect(
      resolveSurfaceKind({ ...base, isSourceMode: true, tab: undefined }),
    ).toBe("source");
  });
});

describe("resolveSurfaceKind — graph and plugin tabs", () => {
  it("is graph for a graph tab, taking priority over every other input", () => {
    const t = tab({ filePath: "", id: "g", type: "graph" });
    expect(
      resolveSurfaceKind({
        ...base,
        isHtmlSourceView: true,
        isSourceMode: true,
        tab: t,
      }),
    ).toBe("graph");
  });

  it("is plugin for a plugin detail tab, taking priority over every other input", () => {
    const t = tab({
      filePath: "",
      id: "p1",
      pluginId: "word-count",
      type: "plugin",
    });
    expect(
      resolveSurfaceKind({
        ...base,
        isHtmlSourceView: true,
        isSourceMode: true,
        tab: t,
      }),
    ).toBe("plugin");
  });

  // §286 Deliberate tightening vs. the old chain. `openPluginTab` is the only path that
  // creates a `type: "plugin"` tab and always supplies a `pluginId`, so this state is not
  // reachable through the app today — but the OLD chain gated on `activePluginIdOf(...)`
  // being truthy (`tab.pluginId ?? null`), which is falsy for a plugin tab with no
  // `pluginId`. That tab would have fallen through to "markdown". This function gates on
  // `isPluginTab(tab)` (the tab's `type`) instead, so it stays "plugin" — the same
  // fail-closed direction `editorSurfaceBlockReason` (`./active-tab.ts`) took.
  it("is plugin even without a pluginId, unlike the old activePluginId-truthiness gate", () => {
    const t = tab({ filePath: "", id: "p1", type: "plugin" });
    expect(resolveSurfaceKind({ ...base, tab: t })).toBe("plugin");
  });
});

describe("resolveSurfaceKind — pdf and image, ahead of source/preview flags", () => {
  it("is pdf for a .pdf file — even with source-mode and html-source-view flags set", () => {
    const t = tab({ filePath: "/vault/doc.pdf" });
    expect(
      resolveSurfaceKind({
        ...base,
        isHtmlSourceView: true,
        isSourceMode: true,
        tab: t,
      }),
    ).toBe("pdf");
  });

  it("is image for a .png file — even with source-mode and html-source-view flags set", () => {
    const t = tab({ filePath: "/vault/pic.png" });
    expect(
      resolveSurfaceKind({
        ...base,
        isHtmlSourceView: true,
        isSourceMode: true,
        tab: t,
      }),
    ).toBe("image");
  });
});

describe("resolveSurfaceKind — HTML files", () => {
  it("is preview for an .html file not showing source", () => {
    const t = tab({ filePath: "/vault/page.html" });
    expect(
      resolveSurfaceKind({ ...base, isHtmlSourceView: false, tab: t }),
    ).toBe("preview");
  });

  it("is source for an .html file toggled to show source", () => {
    const t = tab({ filePath: "/vault/page.html" });
    expect(
      resolveSurfaceKind({ ...base, isHtmlSourceView: true, tab: t }),
    ).toBe("source");
  });

  it("is preview (not double-counted) even if a plugin viewer also claims .html", () => {
    const t = tab({ filePath: "/vault/page.html" });
    expect(
      resolveSurfaceKind({
        ...base,
        fileViewers: [viewer({ extensions: ["html"] })],
        isHtmlSourceView: false,
        tab: t,
      }),
    ).toBe("preview");
  });
});

describe("resolveSurfaceKind — plugin-viewer text files (e.g. SVG)", () => {
  it("is preview for a non-html file a plugin viewer claims, not showing source", () => {
    const t = tab({ filePath: "/vault/diagram.svg" });
    expect(
      resolveSurfaceKind({
        ...base,
        fileViewers: [viewer()],
        isHtmlSourceView: false,
        tab: t,
      }),
    ).toBe("preview");
  });

  it("is source for the same file toggled to show source", () => {
    const t = tab({ filePath: "/vault/diagram.svg" });
    expect(
      resolveSurfaceKind({
        ...base,
        fileViewers: [viewer()],
        isHtmlSourceView: true,
        tab: t,
      }),
    ).toBe("source");
  });

  it("is source (not preview) for the same extension when no viewer claims it", () => {
    const t = tab({ filePath: "/vault/diagram.svg" });
    expect(resolveSurfaceKind({ ...base, fileViewers: [], tab: t })).toBe(
      "source",
    );
  });
});

describe("resolveSurfaceKind — plain non-markdown code files", () => {
  it("is source for an ordinary code file", () => {
    const t = tab({ filePath: "/vault/index.ts" });
    expect(resolveSurfaceKind({ ...base, tab: t })).toBe("source");
  });
});

describe("resolveSurfaceKind — markdown files", () => {
  it("is markdown for a .md file not in source mode", () => {
    const t = tab({ filePath: "/vault/note.md" });
    expect(resolveSurfaceKind({ ...base, isSourceMode: false, tab: t })).toBe(
      "markdown",
    );
  });

  it("is source for a .md file toggled to source mode", () => {
    const t = tab({ filePath: "/vault/note.md" });
    expect(resolveSurfaceKind({ ...base, isSourceMode: true, tab: t })).toBe(
      "source",
    );
  });

  it("treats an untitled file (no path) as markdown, same as a .md file", () => {
    const t = tab({ filePath: "" });
    expect(resolveSurfaceKind({ ...base, isSourceMode: false, tab: t })).toBe(
      "markdown",
    );
    expect(resolveSurfaceKind({ ...base, isSourceMode: true, tab: t })).toBe(
      "source",
    );
  });
});

describe("resolveSurfaceKind — rootPath only matters with no active tab", () => {
  it("gives the same answer for a real tab regardless of rootPath", () => {
    const t = tab({ filePath: "/vault/note.md" });
    expect(resolveSurfaceKind({ ...base, rootPath: null, tab: t })).toBe(
      resolveSurfaceKind({ ...base, rootPath: "/vault", tab: t }),
    );
  });
});
