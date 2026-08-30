// §307 A 노트 쪽에서 자기에게 걸린 태스크를 본다.
//
// 매칭·정렬 자체는 `note-tasks.test.ts`가 순수 함수로 고정한다. 여기서 보는 것은
// **배선**이다: 무엇이 목록의 출처인가, 언제 사라지는가, 체크가 어느 경로를 타는가.
import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);
const setTaskState = vi.fn().mockResolvedValue("- [x] 하나");

// listDir/readFile 스텁이 필요한 이유: 이 컴포넌트 → useZettelIndexStore → 같은
// 모듈에서 그 둘을 import한다. appendTaskLine은 `task-capture`가 가져간다 —
// 이름이 하나라도 빠지면 import 자체가 실패한다.
vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  archiveTaskLines: vi.fn(),
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskStateLine: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskState: (...a: unknown[]) => setTaskState(...a),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { NoteTasksSection } from "../NoteTasksSection";

const NOTE = "/v/notes/202607051530 원자적 노트.md";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "/v/other.md",
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

/**
 * 스토어와 **스캔 결과를 함께** 세운다.
 *
 * 이 섹션은 자기가 스캔을 띄운다(`useTaskScan`). 스토어에만 넣고 `getVaultTasks`를
 * 빈 배열로 두면, 그 스캔이 해소되는 순간 목록이 통째로 지워져 클릭이 사라진 행에
 * 떨어진다 — 실제 앱에서는 둘이 언제나 같은 것이므로 픽스처도 같아야 한다.
 */
function openNote(path: null | string) {
  useEditorStore.setState({
    activeTabId: path === null ? null : "t1",
    mruOrder: path === null ? [] : ["t1"],
    tabs:
      path === null
        ? []
        : [
            {
              contextId: "c",
              filePath: path,
              id: "t1",
              isDirty: false,
              isPinned: false,
              title: "note",
            },
          ],
  });
}

function seed(tasks: TaskEntry[]) {
  getVaultTasks.mockResolvedValue(tasks);
  useTaskStore.getState().setAll(tasks);
}

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/v" });
  useContextStore.setState({ contexts: [] });
  useSettingsStore.setState({
    locale: "en",
    tasksEnabled: true,
    tasksExcludePaths: [],
    tasksRecordDoneDate: true,
    tasksScanScope: "currentVault",
  });
  openNote(NOTE);
});

describe("NoteTasksSection", () => {
  it("링크로 걸린 태스크와 노트 안에 적힌 태스크를 한 목록으로 보인다", () => {
    // 설계 §18.6 A: 사용자에게 "이 노트와 관련된 할 일"은 하나의 목록이다.
    seed([
      task({ links: ["202607051530"], text: "링크로 걸린 것" }),
      task({ line: 3, path: NOTE, text: "노트 안에 적힌 것" }),
      task({ text: "남의 것" }),
    ]);
    render(<NoteTasksSection />);

    expect(screen.getByText("링크로 걸린 것")).toBeInTheDocument();
    expect(screen.getByText("노트 안에 적힌 것")).toBeInTheDocument();
    expect(screen.queryByText("남의 것")).not.toBeInTheDocument();
    expect(screen.getByText(/Tasks in this note \(2\)/)).toBeInTheDocument();
  });

  it("대상이 없으면 그렇게 말한다 — 섹션을 감추지 않는다", () => {
    // 감추면 "이 노트에 걸린 것이 없다"와 "이 기능이 없다"가 화면에서 같아진다.
    seed([task({ text: "남의 것" })]);
    render(<NoteTasksSection />);

    expect(screen.getByText(/Tasks in this note \(0\)/)).toBeInTheDocument();
    expect(screen.getByText(/No task points at this note/)).toBeInTheDocument();
  });

  it("‼️ 태스크 기능이 꺼져 있으면 렌더도 스캔도 없다", async () => {
    useSettingsStore.setState({ tasksEnabled: false });
    seed([task({ links: ["202607051530"] })]);
    const { container } = render(<NoteTasksSection />);

    expect(container).toBeEmptyDOMElement();
    // 설정을 끈 사용자의 vault를 이 섹션이 조용히 걷지 않는다.
    expect(getVaultTasks).not.toHaveBeenCalled();
  });

  it("열린 파일이 없으면 섹션이 없다", () => {
    openNote(null);
    seed([task({ links: ["202607051530"] })]);
    const { container } = render(<NoteTasksSection />);

    expect(container).toBeEmptyDOMElement();
  });

  it("체크는 아젠다와 같은 쓰기 경로를 탄다", async () => {
    seed([task({ links: ["202607051530"], path: "/v/other.md" })]);
    render(<NoteTasksSection />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(setTaskState).toHaveBeenCalledWith(
      "/v/other.md",
      0,
      "- [ ] 하나",
      "done",
      true,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("탭을 옮기면 그 노트의 목록으로 바뀐다", () => {
    seed([
      task({ links: ["202607051530"], text: "이 노트 것" }),
      task({ links: ["프로젝트"], text: "저 노트 것" }),
    ]);
    const { rerender } = render(<NoteTasksSection />);
    expect(screen.getByText("이 노트 것")).toBeInTheDocument();

    openNote("/v/프로젝트.md");
    rerender(<NoteTasksSection />);

    expect(screen.getByText("저 노트 것")).toBeInTheDocument();
    expect(screen.queryByText("이 노트 것")).not.toBeInTheDocument();
  });
});
