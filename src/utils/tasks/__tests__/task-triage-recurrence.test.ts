// §318 아젠다 쪽 굴리기 — 무엇이 IPC로 나가고, 스토어와 화면에 무엇이 남는가.
//
// 규칙 자체는 `task-recurrence.test.ts`가, 전이의 서술은 `task-state-write.test.ts`가
// 본다. 여기서 보는 것은 그 결정이 **실제로 쓰기까지 도달하는가**와, 도달한 뒤 아젠다가
// 자기 상태를 맞추는가다. 에디터 쪽 같은 조작은 `task-item-control.test.ts`에 있다.
import type { TaskEntry } from "../../../ipc/types";
import type { TaskWriteResult } from "../apply-task-write";
import type { TaskTriageContext } from "../task-triage";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn(),
  getVaultTasks: vi.fn(),
  setTaskState: vi.fn(),
}));

vi.mock("../apply-task-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../apply-task-write")>()),
  applyTaskWrite: vi.fn(),
}));

import { t } from "../../../i18n";
import { getFileTasks, setTaskState } from "../../../ipc/invoke";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import * as applyModule from "../apply-task-write";
import { advanceTaskState, writeTaskState } from "../task-triage";

const NOW = new Date(2026, 8, 5);

const CTX: TaskTriageContext = {
  editor: null,
  exclude: [],
  now: NOW,
  recordDoneDate: true,
  t: (key: string, params?: Record<string, string>) => t(key, "en", params),
  trackTime: false,
};

const RAW = "- [/] 주간 회고 🛫2026-08-30 📅2026-09-01 🔁every week";
const ROLLED = "- [ ] 주간 회고 🛫2026-09-06 📅2026-09-08 🔁every week";

const TASK: TaskEntry = {
  cancelled: null,
  created: null,
  done: null,
  due: "2026-09-01",
  indent: 0,
  line: 2,
  links: [],
  path: "/v/a.md",
  priority: 0,
  raw: RAW,
  recurrence: "every week",
  scheduled: null,
  start: "2026-08-30",
  state: "doing",
  tags: [],
  text: "주간 회고",
  timer: null,
};

/** 실제 라우터를 지나가게 한다 — IPC 페이로드를 보려면 그래야 한다. */
function useRealRouter(): void {
  vi.mocked(applyModule.applyTaskWrite).mockImplementation(
    async (task, change, editor) => {
      const actual =
        await vi.importActual<typeof import("../apply-task-write")>(
          "../apply-task-write",
        );
      return actual.applyTaskWrite(task, change, editor);
    },
  );
}

const disk = (raw: string): TaskWriteResult => ({ kind: "disk", raw });

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState({ tasks: [TASK] });
  useUIStore.setState({ toast: null });
  vi.mocked(getFileTasks).mockResolvedValue([]);
  vi.mocked(setTaskState).mockResolvedValue(ROLLED);
  vi.mocked(applyModule.applyTaskWrite).mockResolvedValue(disk(ROLLED));
});

describe("§318 아젠다에서 반복 태스크를 완료하면", () => {
  it("굴린 날짜와 `todo`를 한 번의 쓰기로 보낸다", async () => {
    useRealRouter();

    await advanceTaskState(TASK, CTX);

    expect(setTaskState).toHaveBeenCalledTimes(1);
    expect(setTaskState).toHaveBeenCalledWith("/v/a.md", 2, RAW, {
      dates: { due: "2026-09-08", start: "2026-09-06" },
      // 다음 회차는 아직 하지 않은 일이다.
      newState: "todo",
      // ‼️ 사용자 설정과 무관하게 참 — 남아 있던 ✅/❌를 떼기 위해서다.
      recordDoneDate: true,
      timer: null,
      today: "2026-09-05",
    });
  });

  // 아젠다에서는 이 행이 버킷을 옮겨 시야에서 사라진다 — 굴렀다는 것을 말하는
  // 유일한 신호다.
  it("다음 회차를 토스트로 알린다", async () => {
    await advanceTaskState(TASK, CTX);

    expect(useUIStore.getState().toast?.message).toBe(
      "Next occurrence · 2026-09-08",
    );
  });

  // ‼️ 쓰기가 거절됐는데 "다음 회차"라고 말하면, 사용자는 굴러가지 않은 태스크를
  // 굴러간 것으로 알고 넘어간다. 토스트가 저장 전 콜백 **바깥**에 있어야 하면서도
  // 무조건 뜨면 안 되는 이유다.
  it("stale로 거절된 쓰기에는 아무 말도 하지 않는다", async () => {
    vi.mocked(applyModule.applyTaskWrite).mockResolvedValue({
      kind: "stale",
      target: "disk",
    });

    await advanceTaskState(TASK, CTX);

    expect(useUIStore.getState().toast).toBeNull();
  });

  it("취소도 굴린다", async () => {
    useRealRouter();

    await writeTaskState(TASK, "cancelled", CTX);

    expect(vi.mocked(setTaskState).mock.calls[0][3]).toMatchObject({
      dates: { due: "2026-09-08" },
      newState: "todo",
    });
  });

  // ‼️ 저장 전 경로에서는 디스크 재스캔이 없으므로 스토어를 손으로 맞춰야 한다.
  // 날짜를 함께 옮기지 않으면 이 행이 옛 버킷에 남아, 방금 굴린 태스크가 오늘 화면에
  // 다시 보인다 — 사용자가 보기에는 "체크가 먹지 않았다"이다.
  it("저장 전 문서 경로에서는 스토어의 날짜도 다음 회차로 옮긴다", async () => {
    vi.mocked(applyModule.applyTaskWrite).mockResolvedValue({
      kind: "document",
      raw: ROLLED,
    });

    await advanceTaskState(TASK, CTX);

    const after = useTaskStore.getState().tasks[0];
    expect(after.state).toBe("todo");
    expect(after.due).toBe("2026-09-08");
    expect(after.start).toBe("2026-09-06");
    expect(after.raw).toBe(ROLLED);
    expect(after.done).toBeNull();
  });
});

describe("§318 굴리지 않는 줄은 평범하게 완료된다", () => {
  const PLAIN = { ...TASK, raw: "- [/] 초안 📅2026-09-01", recurrence: null };
  const DONE = "- [x] 초안 📅2026-09-01 ✅2026-09-05";

  beforeEach(() => {
    useTaskStore.setState({ tasks: [PLAIN] });
    vi.mocked(setTaskState).mockResolvedValue(DONE);
    vi.mocked(applyModule.applyTaskWrite).mockResolvedValue(disk(DONE));
  });

  it("날짜를 보내지 않고 요청한 상태를 그대로 쓴다", async () => {
    useRealRouter();

    await advanceTaskState(PLAIN, CTX);

    expect(vi.mocked(setTaskState).mock.calls[0][3]).toMatchObject({
      dates: undefined,
      newState: "done",
    });
  });

  it("토스트를 띄우지 않는다 — 아무것도 굴리지 않았다", async () => {
    await advanceTaskState(PLAIN, CTX);

    expect(useUIStore.getState().toast).toBeNull();
  });
});
