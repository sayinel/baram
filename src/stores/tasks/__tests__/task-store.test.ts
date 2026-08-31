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
    timer: null,
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

describe("patchTask (§305 열린 문서 경로의 낙관적 갱신)", () => {
  beforeEach(() => {
    useTaskStore.getState().clear();
  });

  it("path와 line이 모두 일치하는 엔트리만 patch한다", () => {
    useTaskStore.getState().setAll([task("a.md", "하나"), task("b.md", "둘")]);

    useTaskStore
      .getState()
      .patchTask("a.md", 0, { raw: "- [x] 하나", state: "done" });

    const [a, b] = useTaskStore.getState().tasks;
    expect(a).toMatchObject({ raw: "- [x] 하나", state: "done" });
    expect(b).toMatchObject({ raw: "- [ ] 둘", state: "todo" });
  });

  it("같은 path라도 line이 다르면 건드리지 않는다", () => {
    const t0 = { ...task("a.md", "하나"), line: 0 };
    const t1 = { ...task("a.md", "둘"), line: 1 };
    useTaskStore.getState().setAll([t0, t1]);

    useTaskStore.getState().patchTask("a.md", 1, { state: "done" });

    const [first, second] = useTaskStore.getState().tasks;
    expect(first.state).toBe("todo");
    expect(second.state).toBe("done");
  });

  it("일치하는 엔트리가 없으면 아무것도 바꾸지 않는다", () => {
    useTaskStore.getState().setAll([task("a.md", "하나")]);

    useTaskStore.getState().patchTask("missing.md", 0, { state: "done" });

    expect(useTaskStore.getState().tasks).toEqual([task("a.md", "하나")]);
  });

  it("전달한 필드만 덮어쓰고 나머지는 보존한다", () => {
    useTaskStore.getState().setAll([task("a.md", "하나")]);

    useTaskStore.getState().patchTask("a.md", 0, { done: "2026-08-24" });

    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      done: "2026-08-24",
      raw: "- [ ] 하나",
      text: "하나",
    });
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

    const pA = refreshAllTasks(["/vault"], []);
    const pB = refreshAllTasks(["/vault"], ["archive"]);

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

// §312.1 여러 루트를 한 번에 스캔한다. 이 절이 지키는 것은 **실측이 성립하는 조건**이다:
// 루트 3개 × 1만 파일이 순차 1.24초 / 동시 0.74초였고, 그 1.68배는 호출이 함께 떠 있을
// 때만 얻어진다(§18.7.1 "스캔 비용 실측").
describe("refreshAllTasks — 멀티 루트 (§312.1)", () => {
  beforeEach(() => {
    useTaskStore.getState().clear();
    getVaultTasks.mockReset();
  });

  it("루트를 동시에 부른다 — 하나가 끝나기를 기다리지 않는다", async () => {
    // ‼️ `for await` 루프로 바꾸면 이 단정이 깨진다. 그것이 이 테스트의 존재 이유다:
    // 순차로 되돌아가도 결과는 같아서 다른 어떤 테스트도 그 회귀를 보지 못한다.
    const resolvers: ((v: TaskEntry[]) => void)[] = [];
    getVaultTasks.mockImplementation(
      () => new Promise<TaskEntry[]>((r) => resolvers.push(r)),
    );

    const done = refreshAllTasks(["/a", "/b", "/c"], []);

    // 아직 아무것도 resolve하지 않았는데 세 호출이 모두 떠 있어야 한다.
    expect(getVaultTasks).toHaveBeenCalledTimes(3);
    expect(getVaultTasks.mock.calls.map((c) => c[0])).toEqual([
      "/a",
      "/b",
      "/c",
    ]);

    resolvers.forEach((r, i) => r([task(`${i}.md`, `t${i}`)]));
    await done;
  });

  it("루트별 결과를 하나의 목록으로 합친다", async () => {
    getVaultTasks
      .mockResolvedValueOnce([task("a.md", "from A")])
      .mockResolvedValueOnce([task("b.md", "from B")]);

    await refreshAllTasks(["/a", "/b"], []);

    expect(useTaskStore.getState().tasks.map((t) => t.text)).toEqual([
      "from A",
      "from B",
    ]);
    expect(useTaskStore.getState().error).toBeNull();
  });

  it("루트 하나가 실패해도 나머지는 보여 준다", async () => {
    // 외장 디스크의 vault 하나가 사라졌다고 아젠다 전체가 비면, 사용자는 자기 태스크가
    // 없어진 것으로 읽는다.
    getVaultTasks
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce([task("b.md", "from B")]);

    await refreshAllTasks(["/gone", "/b"], []);

    expect(useTaskStore.getState().tasks.map((t) => t.text)).toEqual([
      "from B",
    ]);
    expect(useTaskStore.getState().error).toBeNull();
  });

  it("전부 실패하면 오류 상태로 간다 — 조용히 빈 목록을 보여 주지 않는다", async () => {
    getVaultTasks.mockRejectedValue(new Error("ENOENT"));

    await refreshAllTasks(["/gone", "/also-gone"], []);

    expect(useTaskStore.getState().error).toContain("ENOENT");
    expect(useTaskStore.getState().loading).toBe(false);
  });

  it("루트가 비어 있으면 아무것도 부르지 않고 목록을 비운다", async () => {
    // 볼트를 닫았거나 태스크 홈이 설정되지 않은 상태. 지난 스캔의 잔상을 남기면
    // 사용자는 지금 보는 것이 어느 범위의 것인지 알 수 없다.
    useTaskStore.getState().setAll([task("a.md", "이전 스캔")]);

    await refreshAllTasks([], []);

    expect(getVaultTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toEqual([]);
  });
});
