// §309 일괄 재조정의 카운터·라우팅 회계. 여기서는 라우터를 통째로 모킹해
// 디스크 경로만 본다 — 실제 라우터에 대고 도는 문서 경로는
// task-bulk-actions-document.test.ts가 본다.
import type { TaskEntry } from "../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/tasks/apply-task-write", () => ({
  applyTaskWrite: vi.fn(),
  applyToContent: vi.fn(),
  // 술어는 모킹하지 않고 진짜와 같은 규칙을 적는다 — vi.fn()으로 두면 이 파일의
  // 회계 단정이 "디스크였는가"를 묻지 못한다. 진짜 구현은 apply-task-write.test.ts가 핀한다.
  isUnsavedWrite: (r: null | { kind: string }) =>
    r?.kind === "document" || r?.kind === "source",
  resolveTaskWriteTarget: vi.fn(() => ({ kind: "disk" })),
}));

import {
  applyTaskWrite,
  resolveTaskWriteTarget,
} from "../../../utils/tasks/apply-task-write";
import { rescheduleOverdueToToday } from "../task-bulk-actions";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: "2026-08-20",
    indent: 0,
    line: 0,
    links: [],
    path: "/v/a.md",
    priority: 0,
    raw: "- [ ] a 📅2026-08-20",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "a",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTaskWriteTarget).mockReturnValue({ kind: "disk" });
});

describe("rescheduleOverdueToToday", () => {
  it("각 태스크의 기한 필드를 오늘로 세운다", async () => {
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "disk", raw: "" });
    const r = await rescheduleOverdueToToday([task()], "2026-08-24", null);
    expect(applyTaskWrite).toHaveBeenCalledWith(
      expect.objectContaining({ line: 0 }),
      {
        field: "due",
        kind: "field",
        value: "2026-08-24",
      },
      null,
    );
    expect(r.updated).toBe(1);
  });

  it("`⏳`만으로 기한 초과가 된 태스크는 `scheduled`를 민다 — 없던 마감(`📅`)을 만들지 않는다", async () => {
    // 버킷은 `due ?? scheduled`로 판정하므로 `due`가 없는 태스크도 Overdue에
    // 들어온다. 거기에 `📅`를 붙이면 사용자가 정한 적 없는 마감이 생기고
    // 한 줄에 `⏳옛날 📅오늘`이라는 모순되는 두 날짜가 남는다.
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "disk", raw: "" });
    await rescheduleOverdueToToday(
      [
        task({
          due: null,
          raw: "- [ ] a ⏳2026-08-01",
          scheduled: "2026-08-01",
        }),
      ],
      "2026-08-24",
      null,
    );
    expect(applyTaskWrite).toHaveBeenCalledWith(
      expect.anything(),
      { field: "scheduled", kind: "field", value: "2026-08-24" },
      null,
    );
  });

  it("실패한 항목이 있어도 나머지를 계속 처리한다", async () => {
    vi.mocked(applyTaskWrite)
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce({ kind: "disk", raw: "" });
    const r = await rescheduleOverdueToToday(
      [task({ line: 0 }), task({ line: 1 })],
      "2026-08-24",
      null,
    );
    expect(applyTaskWrite).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ failed: 1, updated: 1 });
  });

  it("stale은 실패와 따로 센다 — 정상 경합이지 오류가 아니다", async () => {
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "stale" });
    const r = await rescheduleOverdueToToday([task()], "2026-08-24", null);
    expect(r).toMatchObject({ failed: 0, stale: 1, updated: 0 });
  });

  it("디스크에 쓴 파일 경로를 중복 없이 모은다 — 호출자가 그만큼만 다시 읽는다", async () => {
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "disk", raw: "" });
    const r = await rescheduleOverdueToToday(
      [
        task({ line: 0, path: "/v/a.md" }),
        task({ line: 1, path: "/v/a.md" }),
        task({ line: 0, path: "/v/b.md" }),
      ],
      "2026-08-24",
      null,
    );
    expect(r.diskPaths.sort()).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("빈 목록이면 아무것도 부르지 않는다", async () => {
    const r = await rescheduleOverdueToToday([], "2026-08-24", null);
    expect(applyTaskWrite).not.toHaveBeenCalled();
    expect(r).toMatchObject({ diskPaths: [], failed: 0, stale: 0, updated: 0 });
  });

  it("성공·stale·실패가 섞인 배치에서도 각 카운터가 정확하고 합이 처리한 개수와 같다 — 중복 집계도 누락도 없다", async () => {
    // 앞 두 태스크는 같은 파일(/v/a.md)을 공유한다 — 성공/stale이 둘 다
    // diskPaths를 채우면서도 중복 없이 한 번만 남는지 같은 호출에서 함께 본다.
    vi.mocked(applyTaskWrite)
      .mockResolvedValueOnce({ kind: "disk", raw: "" }) // 성공
      .mockResolvedValueOnce({ kind: "stale" }) // 경합
      .mockRejectedValueOnce(new Error("disk full")); // 오류

    const tasks = [
      task({ line: 0, path: "/v/a.md" }),
      task({ line: 1, path: "/v/a.md" }),
      task({ line: 0, path: "/v/b.md" }),
    ];
    const r = await rescheduleOverdueToToday(tasks, "2026-08-24", null);

    expect(r.updated).toBe(1);
    expect(r.stale).toBe(1);
    expect(r.failed).toBe(1);
    // 카운터의 합이 처리한 태스크 수와 같아야 한다 — 이중 집계나 누락이 없다는 증거.
    expect(r.updated + r.stale + r.failed).toBe(tasks.length);
    // 실패한 태스크(/v/b.md)는 diskPaths에 들어가지 않는다 — 쓰지 않은 파일을
    // 다시 읽을 이유가 없다. /v/a.md는 성공·stale 둘 다 한 번만 남는다.
    expect(r.diskPaths).toEqual(["/v/a.md"]);
  });
});
