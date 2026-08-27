// §312 `writeAndReconcile` 직접 테스트 — 네 판정이 공유하는 **유일한** 회계.
//
// 왜 조작별 테스트가 있는데도 따로 두는가: 네 판정이 여기로 모이면서 이 함수의 한 줄을
// 고치면 스무 개 남짓한 테스트가 한꺼번에 빨간불이 된다. 그 화면으로는 "무엇이 깨졌는지"를
// 읽을 수 없다 — 조작마다 한 번씩 같은 실패가 반복될 뿐이다. 이 파일은 그 실패에 이름을
// 붙인다: 깨진 것은 어떤 조작이 아니라 **공유 회계의 이 갈래**다.
//
// 결과값을 직접 주므로 라우터(`applyTaskWrite`)는 지나가지 않는다. 그쪽 판정은
// `apply-task-write.test.ts`가 본다.
import type { TaskEntry } from "../../../ipc/types";
import type { TaskDeleteResult, TaskWriteResult } from "../apply-task-write";
import type { TaskTriageContext } from "../task-triage";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn(),
  getVaultTasks: vi.fn(),
}));

import { t } from "../../../i18n";
import { getFileTasks } from "../../../ipc/invoke";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { writeAndReconcile } from "../task-triage-write";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

const NOW = new Date(2026, 7, 26);

const CTX: TaskTriageContext = {
  editor: null,
  exclude: ["archive"],
  now: NOW,
  rootPath: "/vault",
  t: EN_T,
};

const TASK: TaskEntry = {
  cancelled: null,
  created: null,
  done: null,
  due: null,
  indent: 0,
  line: 3,
  links: [],
  path: "a.md",
  priority: 0,
  raw: "- [ ] 하나",
  recurrence: null,
  scheduled: null,
  start: null,
  state: "todo",
  tags: [],
  text: "하나",
};

/** 한 갈래를 돌리고 무엇이 일어났는지 한 덩어리로 돌려준다. */
async function run(result: Error | TaskDeleteResult | TaskWriteResult) {
  const reconciled = vi.fn();
  await writeAndReconcile(
    TASK,
    CTX,
    () =>
      result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result),
    reconciled,
  );
  return {
    reconciled,
    rescan: vi.mocked(getFileTasks).mock.calls,
    toast: useUIStore.getState().toast,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFileTasks).mockResolvedValue([]);
  useTaskStore.getState().clear();
  useUIStore.getState().dismissToast();
});

describe("§312 회계 — 디스크가 진실원인 갈래", () => {
  it("디스크에 썼으면 그 파일만, rootPath·exclude를 실어 다시 읽는다", async () => {
    const r = await run({ kind: "disk", raw: "- [x] 하나" });

    expect(r.rescan).toEqual([["a.md", "/vault", ["archive"]]]);
    expect(r.reconciled).not.toHaveBeenCalled();
    expect(r.toast).toBeNull();
  });

  // 디스크 stale은 일시적 경합이다 — 다시 읽으면 저절로 수습되므로 조용하다.
  it("디스크에서 거절되면 조용히 다시 읽기만 한다", async () => {
    const r = await run({ kind: "stale", target: "disk" });

    expect(r.rescan).toHaveLength(1);
    expect(r.reconciled).not.toHaveBeenCalled();
    expect(r.toast).toBeNull();
  });

  // ‼️ 문구는 **넘겨받은 `t`에서** 와야 한다. 영어로만 확인하면 하드코딩된 사본과
  // 키에서 온 값이 바이트가 같아 아무것도 가르지 못한다 — 이 슬라이스가 실제로 겪은
  // 실패다(체크 판정의 영어 사본이 그 키의 영어와 같았다).
  it("실패 문구는 컨텍스트의 t를 탄다 — 로케일을 바꾸면 함께 바뀐다", async () => {
    const reconciled = vi.fn();
    await writeAndReconcile(
      TASK,
      { ...CTX, t: (key, params) => t(key, "ko", params) },
      () => Promise.reject(new Error("Permission denied (os error 13)")),
      reconciled,
    );

    expect(useUIStore.getState().toast?.message).toBe(
      t("tasks.triage.writeFailed", "ko"),
    );
  });

  // ‼️ 예외로 실패했으면 무엇이 남았는지 알 수 없다 — 디스크를 읽어 사실과 맞춰야 한다.
  it("stale이 아닌 실패는 토스트로 알리고 그래도 다시 읽는다", async () => {
    const r = await run(new Error("Permission denied (os error 13)"));

    expect(r.toast?.type).toBe("error");
    expect(r.toast?.message).toBe(EN_T("tasks.triage.writeFailed"));
    expect(r.rescan).toHaveLength(1);
    expect(r.reconciled).not.toHaveBeenCalled();
  });
});

describe("§312 회계 — 아직 저장되지 않은 갈래", () => {
  it("문서에 썼으면 다시 읽지 않고 호출자의 화해를 부른다", async () => {
    const written = { kind: "document", raw: "- [x] 하나" } as const;
    const r = await run(written);

    expect(r.reconciled).toHaveBeenCalledWith(written);
    expect(r.rescan).toHaveLength(0);
    expect(r.toast).toBeNull();
  });

  it("소스 버퍼에 썼을 때도 같다", async () => {
    const written = { kind: "source", raw: "- [x] 하나" } as const;
    const r = await run(written);

    expect(r.reconciled).toHaveBeenCalledWith(written);
    expect(r.rescan).toHaveLength(0);
  });

  // `raw`가 없는 결과(삭제)도 같은 술어를 타야 한다 — 여기서 갈리면 회계가 두 벌이 된다.
  it("raw가 없는 삭제 결과도 저장 전 갈래로 센다", async () => {
    const r = await run({ kind: "document" });

    expect(r.reconciled).toHaveBeenCalledWith({ kind: "document" });
    expect(r.rescan).toHaveLength(0);
  });
});

// ‼️ 이 세 갈래가 하나로 뭉뚱그려지는 것이 이 슬라이스에서 가장 비싼 결함이었다.
// 다시 읽으면 같은 세션이 그 버퍼에 만들어 둔 **다른 줄의** 변경까지 되돌아간다.
describe("§312 회계 — 저장 전 표면에서 거절된 갈래", () => {
  for (const target of ["buffer", "document", "source"] as const) {
    it(`${target}에서 거절되면 다시 읽지 않고 알린다`, async () => {
      const r = await run({ kind: "stale", target });

      expect(r.rescan).toHaveLength(0);
      expect(r.reconciled).not.toHaveBeenCalled();
      expect(r.toast?.type).toBe("info");
      expect(r.toast?.message).toBe(EN_T("tasks.unsavedConflict"));
    });
  }
});
