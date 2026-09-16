// issue 595 — a directory rename moves every tab under it to the new path.
// The check used `oldDir + "/"`, so on Windows, where tab paths are joined
// with `\`, no tab under the renamed directory moved: the tree showed the
// new path while the tab still pointed at the removed one, and a dirty tab
// would have saved to a path that no longer existed. A directory rename
// changes no file's own name, so the titles stay as they were.
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor";

const tab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: `${id}.md`,
});

describe("renameDirInTabs", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: "a",
      mruOrder: ["a", "b", "c", "d", "e"],
      sourceModeTabs: [],
      tabs: [
        tab("a", "C:\\vault\\ns\\a.md"),
        tab("b", "C:\\vault\\ns\\sub\\b.md"),
        tab("c", "C:\\vault\\ns-old\\c.md"),
        tab("d", "/v/ns/d.md"),
        tab("e", "/v/ns\\e.md"),
      ],
    });
  });

  it("moves the tabs under a directory joined with a backslash, and keeps their titles (issue 595)", () => {
    useEditorStore
      .getState()
      .renameDirInTabs("C:\\vault\\ns", "C:\\vault\\ns2");
    const byId = Object.fromEntries(
      useEditorStore.getState().tabs.map((t) => [t.id, t]),
    );
    expect(byId.a.filePath).toBe("C:\\vault\\ns2\\a.md");
    expect(byId.b.filePath).toBe("C:\\vault\\ns2\\sub\\b.md");
    expect(byId.a.title).toBe("a.md");
    expect(byId.b.title).toBe("b.md");
    // A sibling that shares the prefix, and a tab elsewhere, stay put.
    expect(byId.c.filePath).toBe("C:\\vault\\ns-old\\c.md");
    expect(byId.d.filePath).toBe("/v/ns/d.md");
  });

  it("still moves the tabs under a directory joined with a slash, and not a Unix sibling with a backslash in its name", () => {
    useEditorStore.getState().renameDirInTabs("/v/ns", "/v/renamed");
    const byId = Object.fromEntries(
      useEditorStore.getState().tabs.map((t) => [t.id, t]),
    );
    expect(byId.d.filePath).toBe("/v/renamed/d.md");
    // `/v/ns\e.md` is a file beside the directory, not one inside it.
    expect(byId.e.filePath).toBe("/v/ns\\e.md");
  });
});
