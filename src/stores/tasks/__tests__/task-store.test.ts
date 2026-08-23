import type { TaskEntry } from "../../../ipc/types";

import { beforeEach, describe, expect, it } from "vitest";

import { useTaskStore } from "../task-store";

function task(path: string, text: string): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path,
    priority: 0,
    raw: `- [ ] ${text}`,
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text,
  };
}

describe("useTaskStore", () => {
  beforeEach(() => {
    useTaskStore.getState().clear();
  });

  it("replaces only the given file's entries", () => {
    useTaskStore.getState().setAll([task("a.md", "하나"), task("b.md", "둘")]);

    useTaskStore.getState().replaceFile("a.md", [task("a.md", "하나 수정")]);

    const texts = useTaskStore
      .getState()
      .tasks.map((t) => t.text)
      .sort();
    expect(texts).toEqual(["둘", "하나 수정"]);
  });

  it("adds a file that was not in the store yet", () => {
    useTaskStore.getState().setAll([task("a.md", "하나")]);

    useTaskStore.getState().replaceFile("new.md", [task("new.md", "새로")]);

    expect(useTaskStore.getState().tasks).toHaveLength(2);
  });

  it("drops every entry for a deleted file", () => {
    useTaskStore.getState().setAll([task("a.md", "하나"), task("b.md", "둘")]);

    useTaskStore.getState().removeFile("a.md");

    expect(useTaskStore.getState().tasks.map((t) => t.path)).toEqual(["b.md"]);
  });

  it("removes a file's entries when it no longer contains tasks", () => {
    useTaskStore.getState().setAll([task("a.md", "하나")]);

    useTaskStore.getState().replaceFile("a.md", []);

    expect(useTaskStore.getState().tasks).toHaveLength(0);
  });
});
