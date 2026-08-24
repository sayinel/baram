import type { TaskEntry } from "../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/tasks/apply-task-write", () => ({
  applyTaskWrite: vi.fn(),
}));

import { applyTaskWrite } from "../../../utils/tasks/apply-task-write";
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

beforeEach(() => vi.clearAllMocks());

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

  it("건드린 파일 경로를 중복 없이 모은다 — 호출자가 그만큼만 다시 읽는다", async () => {
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
    expect(r.touchedPaths.sort()).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("빈 목록이면 아무것도 부르지 않는다", async () => {
    const r = await rescheduleOverdueToToday([], "2026-08-24", null);
    expect(applyTaskWrite).not.toHaveBeenCalled();
    expect(r).toMatchObject({ failed: 0, stale: 0, updated: 0 });
  });

  it("열린 문서에 쓴 것도 updated로 센다", async () => {
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "document", raw: "" });
    const r = await rescheduleOverdueToToday([task()], "2026-08-24", null);
    expect(r.updated).toBe(1);
  });
});
