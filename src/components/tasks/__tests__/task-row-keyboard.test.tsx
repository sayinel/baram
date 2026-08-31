// §312 "네 조작 모두 아젠다에서 **키 한 번**으로" — 실제 패널에서.
//
// 표 자체는 `utils/tasks/__tests__/task-row-keys.test.ts`가 본다. 여기서 보는 것은 그
// 표가 실제로 배선돼 있는가다: 키를 누르면 IPC가 나가는가, 파괴적 판정이 확인 관문을
// **우회하지 않는가**, 그리고 패널의 입력란에서 친 글자가 판정으로 새지 않는가.
//
// 진짜 `TaskAgendaPanel`을 렌더한다 — 배선을 테스트가 다시 만들면 그 배선이 빠져도
// 초록불이다(이 슬라이스가 이미 한 번 겪은 실패 양식).
import type { TaskEntry } from "../../../ipc/types";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteTaskLine = vi.fn();
const setTaskField = vi.fn();
const setTaskState = vi.fn();
const setTaskTag = vi.fn();
const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);

// listDir/readFile 스텁이 필요한 이유는 task-agenda-panel.test.tsx와 같다 —
// TaskAgendaPanel → useZettelIndexStore가 같은 모듈에서 그 둘을 import한다.
vi.mock("../../../ipc/invoke", () => ({
  deleteTaskLine: (...a: unknown[]) => deleteTaskLine(...a),
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  previewTaskTagLine: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskField: (...a: unknown[]) => setTaskField(...a),
  setTaskState: (...a: unknown[]) => setTaskState(...a),
  setTaskTag: (...a: unknown[]) => setTaskTag(...a),
}));

vi.mock("../../../utils/editor/serialize-live-doc", () => ({
  serializeLiveDoc: vi.fn(),
}));

import { EditorProvider } from "../../../contexts/editor-context";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { TASK_ROW_KEYSHORTCUTS } from "../../../utils/tasks/task-row-keys";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

function overlay(): Element | null {
  return document.querySelector(".ai-prompt-overlay");
}

/** 패널을 띄우고 그 행의 `<li>`를 돌려준다 — 포커스까지 준다(키는 행이 받는다). */
function renderPanel(entries: TaskEntry[] = [task()]): HTMLElement {
  useTaskStore.getState().setAll(entries);
  render(
    <EditorProvider value={null}>
      <TaskAgendaPanel />
    </EditorProvider>,
  );
  const row = screen.getByText(entries[0].text).closest("li")!;
  row.focus();
  return row;
}

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
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
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setTaskField.mockResolvedValue("- [ ] 하나 📅2026-08-26");
  setTaskState.mockResolvedValue("- [x] 하나");
  setTaskTag.mockResolvedValue("- [ ] 하나 #someday");
  getFileTasks.mockResolvedValue([]);
  getVaultTasks.mockResolvedValue([]);
  useTaskStore.getState().clear();
  useUIStore.getState().dismissToast();
});

afterEach(async () => {
  // 확인 대화상자는 document.body에 직접 붙는다 — RTL cleanup은 자기 컨테이너만 치운다.
  //
  // ‼️ 뜯어내지 않고 **취소로 닫는다.** `showConfirm`의 프로미스는 사용자가 답할 때만
  // 풀린다(프로덕션에는 이 오버레이를 밖에서 지우는 코드가 없다 — 확인·취소·바깥 클릭·
  // Enter·Escape가 전부다). DOM에서 그냥 지우면 그 프로미스가 영영 pending으로 남아
  // `confirmAndDeleteTaskLine`의 재진입 잠금이 걸린 채 다음 테스트로 넘어가고, 그 테스트의
  // 삭제는 조용히 아무 일도 하지 않는다.
  for (const node of document.querySelectorAll(".ai-prompt-overlay")) {
    node.querySelector<HTMLButtonElement>(".ai-prompt-btn-cancel")?.click();
    node.remove();
  }
  // `finally`가 도는 마이크로태스크까지 흘린다.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("§312 네 판정에 키 한 번으로 닿는다", () => {
  it("t는 그 행의 기한을 오늘로 세운다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "t" });

    await waitFor(() =>
      expect(setTaskField).toHaveBeenCalledWith(
        "a.md",
        0,
        "- [ ] 하나",
        "due",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ),
    );
  });

  it("s는 그 행에 #someday를 붙인다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "s" });

    await waitFor(() =>
      expect(setTaskTag).toHaveBeenCalledWith(
        "a.md",
        0,
        "- [ ] 하나",
        "someday",
        true,
      ),
    );
  });

  it("x는 체크박스와 같은 쓰기를 낸다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "x" });

    await waitFor(() =>
      expect(setTaskState).toHaveBeenCalledWith(
        "a.md",
        0,
        "- [ ] 하나",
        "done",
        true,
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ),
    );
  });

  it("d는 그대로 메뉴를 연다 — 삭제가 아니다", () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "d" });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });
});

// ‼️ 삭제는 되돌릴 수 없다. 키 경로가 확인 관문을 우회하면 오타 한 번이 줄 하나를
// 영구히 지운다 — 이 슬라이스에 그것을 되돌릴 통로가 없다.
describe("§312 키로 지워도 확인이 먼저다", () => {
  it("Delete는 확인을 띄우고, 그 전에는 IPC가 나가지 않는다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "Delete" });

    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });

  it("확인해야 비로소 지운다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "Delete" });
    await waitFor(() => expect(overlay()).not.toBeNull());
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".confirm-dialog-btn-danger")!,
    );

    await waitFor(() =>
      expect(deleteTaskLine).toHaveBeenCalledWith("a.md", 0, "- [ ] 하나"),
    );
  });

  it("취소하면 아무것도 지우지 않는다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "Delete" });
    await waitFor(() => expect(overlay()).not.toBeNull());
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".ai-prompt-btn-cancel")!,
    );

    await waitFor(() => expect(overlay()).toBeNull());
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });

  it("확인 문구에 지울 줄의 원문이 들어간다", async () => {
    const row = renderPanel([task({ raw: "  - [ ] 들여쓴 하위 항목" })]);

    fireEvent.keyDown(row, { key: "Delete" });

    await waitFor(() =>
      expect(document.querySelector(".ai-prompt-label")?.textContent).toContain(
        "  - [ ] 들여쓴 하위 항목",
      ),
    );
  });
});

// 앱 단축키(Cmd+K 등)는 행에 포커스가 있어도 살아 있어야 한다.
describe("§312 수식키가 붙은 키는 행이 삼키지 않는다", () => {
  it("Cmd+Delete는 확인조차 띄우지 않는다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "Delete", metaKey: true });

    await Promise.resolve();
    expect(overlay()).toBeNull();
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });

  it("Cmd+K는 행 포커스를 옮기지 않는다", () => {
    const row = renderPanel([task(), task({ line: 1, text: "둘" })]);
    const second = screen.getByText("둘").closest("li")!;

    fireEvent.keyDown(row, { key: "k", metaKey: true });

    expect(document.activeElement).toBe(row);
    expect(document.activeElement).not.toBe(second);
  });

  it("수식키 없는 j/k는 그대로 움직인다", () => {
    // 버킷은 자기 비교자로 정렬하므로 화면 순서는 DOM에서 읽는다.
    renderPanel([task(), task({ line: 1, text: "둘" })]);
    const rows = [...document.querySelectorAll<HTMLElement>("li.task-row")];
    rows[0].focus();

    fireEvent.keyDown(rows[0], { key: "j" });

    expect(document.activeElement).toBe(rows[1]);
  });
});

describe("§312 키 경로의 발견 가능성", () => {
  it("행이 자기 단축키를 보조기술에 알린다", () => {
    const row = renderPanel();

    expect(row.getAttribute("aria-keyshortcuts")).toBe(TASK_ROW_KEYSHORTCUTS);
  });

  it("메뉴 항목이 자기 키를 함께 보인다", () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "d" });

    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("T");
    expect(menu.textContent).toContain("S");
    expect(menu.textContent).toContain("Del");
  });

  it("체크박스가 자기 키를 툴팁으로 보인다", () => {
    renderPanel();

    expect(
      screen.getByRole("checkbox", { name: /하나/ }).getAttribute("title"),
    ).toContain("X");
  });
});

// ‼️ 글자키를 판정에 쓰면 입력란이 그 판정으로 새는지 반드시 확인해야 한다.
describe("§312 입력란에서 친 글자는 판정이 아니다", () => {
  it("필터 입력에 t·s·x·d를 쳐도 아무 판정도 돌지 않는다", async () => {
    renderPanel();
    const input = screen.getByLabelText("Filter tasks");

    await userEvent.type(input, "tsxd");

    expect(input).toHaveValue("tsxd");
    expect(setTaskField).not.toHaveBeenCalled();
    expect(setTaskTag).not.toHaveBeenCalled();
    expect(setTaskState).not.toHaveBeenCalled();
    expect(deleteTaskLine).not.toHaveBeenCalled();
    expect(overlay()).toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("상태 선택에서 키보드로 골라도 판정이 돌지 않는다", async () => {
    renderPanel();
    const select = screen.getByLabelText("Filter by state");

    await userEvent.selectOptions(select, "done");
    fireEvent.keyDown(select, { key: "t" });

    expect(setTaskField).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

/** 모든 마이크로태스크를 흘린다 — "아직 부르지 않았다"를 믿을 수 있게 하는 조건. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// §312 IME. 표 자체는 `utils/tasks/__tests__/task-row-keys.test.ts`가 본다 — 여기서 보는
// 것은 그 관문이 실제로 **배선돼 있는가**다. `isComposing`은 React 합성 이벤트에 없어서
// `nativeEvent`에서 꺼내야 하는데, 필드가 선택이라 빠뜨려도 타입은 통과한다. 즉 순수
// 테스트만으로는 관문이 꺼져 있어도 초록불이다.
describe("§312 IME가 가져간 키는 행의 것이 아니다", () => {
  it("조합 중인 키는 어떤 판정도 내지 않는다 — 화면도 파일도 그대로다", async () => {
    const row = renderPanel();

    for (const key of ["x", "t", "s", "d", "Delete", "Backspace"]) {
      fireEvent.keyDown(row, { isComposing: true, key });
    }
    await flush();

    expect(setTaskState).not.toHaveBeenCalled();
    expect(setTaskField).not.toHaveBeenCalled();
    expect(setTaskTag).not.toHaveBeenCalled();
    expect(deleteTaskLine).not.toHaveBeenCalled();
    // 화면에도 아무 일이 없어야 한다 — 메뉴도, 확인 대화상자도 열리지 않는다.
    expect(screen.queryByRole("menu")).toBeNull();
    expect(overlay()).toBeNull();
    expect(useTaskStore.getState().tasks[0].raw).toBe("- [ ] 하나");
  });

  // ‼️ 파괴적 판정을 따로 못 박는다. 조합 중 `Delete`가 새면 확인 관문이 뜨긴 하지만,
  // 사용자가 누른 것은 조합을 끝내려던 키다 — 지울 의사를 표시한 적이 없다.
  it("조합 중 Delete는 확인조차 띄우지 않는다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { isComposing: true, key: "Delete" });
    await flush();

    expect(overlay()).toBeNull();
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });
});

// 한글 입력 상태에서 글자키는 자모로 도착한다(`x` → `ㅌ`). 폴백이 없으면 세 안전한 판정과
// 메뉴 키만 죽고, 어떤 입력기도 가져가지 않는 `Delete`/`Backspace`는 그대로 살아남는다 —
// 한국어 사용자에게 **되돌릴 수 없는 조작만 닿는** 비대칭이다. 아래 넷이 그 비대칭이
// 없다는 증거다.
describe("§312 한글 배열에서도 네 판정 모두 닿는다", () => {
  it("ㅌ(KeyX)는 그 줄을 완료로 바꾼다", async () => {
    let file = "- [ ] 하나\n";
    setTaskState.mockImplementation(async (_p, line, raw) => {
      const lines = file.split("\n");
      if (lines[line as number] !== raw) throw "stale";
      lines[line as number] = raw.replace("- [ ]", "- [x]");
      file = lines.join("\n");
      return lines[line as number];
    });
    const row = renderPanel();

    fireEvent.keyDown(row, { code: "KeyX", key: "ㅌ" });

    await waitFor(() => expect(file).toBe("- [x] 하나\n"));
  });

  it("ㅅ(KeyT)는 그 줄에 오늘 기한을 적는다", async () => {
    let file = "- [ ] 하나\n";
    setTaskField.mockImplementation(async (_p, line, raw, _f, value) => {
      const lines = file.split("\n");
      if (lines[line as number] !== raw) throw "stale";
      lines[line as number] = `${raw} 📅${value}`;
      file = lines.join("\n");
      return lines[line as number];
    });
    const row = renderPanel();

    fireEvent.keyDown(row, { code: "KeyT", key: "ㅅ" });

    await waitFor(() =>
      expect(file).toMatch(/^- \[ \] 하나 📅\d{4}-\d{2}-\d{2}\n$/),
    );
  });

  it("ㄴ(KeyS)는 그 줄에 #someday를 적는다", async () => {
    let file = "- [ ] 하나\n";
    setTaskTag.mockImplementation(async (_p, line, raw, tag) => {
      const lines = file.split("\n");
      if (lines[line as number] !== raw) throw "stale";
      lines[line as number] = `${raw} #${tag}`;
      file = lines.join("\n");
      return lines[line as number];
    });
    const row = renderPanel();

    fireEvent.keyDown(row, { code: "KeyS", key: "ㄴ" });

    await waitFor(() => expect(file).toBe("- [ ] 하나 #someday\n"));
  });

  it("ㅇ(KeyD)는 메뉴를 연다", () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { code: "KeyD", key: "ㅇ" });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });
});

// §312 확인 관문의 재진입. 두 `Delete`가 한 프레임 안에 들어오면 대화상자가 둘 쌓이고,
// 둘 다 확인하면 같은 인자로 `deleteTaskLine`이 두 번 나간다 — 낙관적 잠금은
// `(줄 번호, 원문)`뿐이라 바이트가 같은 이웃 줄이 있으면 **다른 줄이 함께 사라진다**.
describe("§312 두 번 눌러도 대화상자는 하나다", () => {
  it("한 프레임 안의 두 번째 Delete는 대화상자를 쌓지 않는다", async () => {
    const row = renderPanel();

    fireEvent.keyDown(row, { key: "Delete" });
    fireEvent.keyDown(row, { key: "Delete" });
    await waitFor(() => expect(overlay()).not.toBeNull());

    expect(document.querySelectorAll(".ai-prompt-overlay")).toHaveLength(1);
  });
});
