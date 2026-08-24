import type { TaskEntry } from "../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn();
const getFileTasks = vi.fn();

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
}));

import { refreshAllTasks, useTaskStore } from "../task-store";

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
    getVaultTasks.mockReset();
    getFileTasks.mockReset();
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

describe("refreshAllTasks (I3 stale-response guard)", () => {
  beforeEach(() => {
    useTaskStore.getState().clear();
    getVaultTasks.mockReset();
  });

  it("keeps the later scan's results when an earlier scan resolves last", async () => {
    // Scan A starts first (shorter/older exclude list), then scan B starts
    // (e.g. the user just typed another excluded folder). B resolves first;
    // A resolves after. Without the sequence guard, A's stale result would
    // overwrite B's and resurrect tasks from a folder the user just excluded.
    let resolveA!: (v: TaskEntry[]) => void;
    let resolveB!: (v: TaskEntry[]) => void;
    const a = new Promise<TaskEntry[]>((r) => (resolveA = r));
    const b = new Promise<TaskEntry[]>((r) => (resolveB = r));
    getVaultTasks.mockReturnValueOnce(a).mockReturnValueOnce(b);

    const pA = refreshAllTasks("/vault", []);
    const pB = refreshAllTasks("/vault", ["archive"]);

    resolveB([task("b.md", "from B")]);
    await pB;
    resolveA([task("a.md", "from A")]);
    await pA;

    expect(useTaskStore.getState().tasks.map((t) => t.text)).toEqual([
      "from B",
    ]);
    expect(useTaskStore.getState().loading).toBe(false);
  });
});
