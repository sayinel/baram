// §56 저널 저장이 한 번 날 때마다 Memories 패널이 "불러오는 중" 자리표시자로 바뀌는지 본다.
//
// 요점은 자리표시자가 **언제** 나오는가다. 첫 로드에는 보여줄 것이 없으니 맞고, 이미
// 카드가 그려진 뒤의 백그라운드 갱신에는 틀리다 — `.memories-loading`은 위아래 32px
// 패딩을 두른 블록이라, 자동 저장 한 번에 이것이 끼어들고 빠지면서 아래의 연도 카드가
// 90px쯤 밀렸다 돌아온다. 사용자가 본 "메모리 바가 깜박인다"가 이것이다.
//
// 그래서 단정은 "갱신이 돌았다"가 아니라 "갱신 중에도 카드가 제자리에 있고 자리표시자가
// 없다"다. 갱신 중간 상태를 보려면 파일 읽기를 붙잡아 둬야 하므로 readFile을 게이트로 쓴다.

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const listDir = vi.fn();
const readFile = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/invoke", () => ({
  listDir: (path: string) => listDir(path) as Promise<unknown>,
  readFile: (path: string) => readFile(path) as Promise<string>,
  setConfig: vi.fn().mockResolvedValue(undefined),
  updateFileIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { MemoriesPanel } = await import("../MemoriesPanel");
const { useFileStore } = await import("../../../stores/file/file");
const { useSettingsStore } = await import("../../../stores/settings/store");
const { useUIStore } = await import("../../../stores/ui/ui");
const { notifyJournalChanged } =
  await import("../../../utils/journal/journal-events");

// 패널은 오늘 날짜로 열린다. 날짜를 고정하지 않고 오늘에서 경로를 만들어 둔다.
const now = new Date();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const dd = String(now.getDate()).padStart(2, "0");
const thisYear = now.getFullYear();
const lastYear = thisYear - 1;
const pathFor = (y: number) =>
  `/vault/journal/daily/${y}/${mm}/${y}-${mm}-${dd}.md`;

const folder = (name: string) => ({
  name,
  path: `/vault/journal/daily/${name}`,
  isDir: true,
  size: 0,
  modifiedAt: 0,
});

const CONTENT: Record<string, string> = {
  [pathFor(lastYear)]: "## Diary\n\n작년의 첫 문단.\n",
  [pathFor(thisYear)]: "## Diary\n\n올해의 첫 문단.\n",
};

/** 다음 readFile 호출들을 붙잡는다. release()로 풀어 준다. */
function holdReads(): { release: () => void } {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  readFile.mockImplementation(async (path: string) => {
    await held;
    if (!(path in CONTENT)) throw new Error(`no such file: ${path}`);
    return CONTENT[path];
  });
  return { release };
}

/** 마이크로태스크를 흘려 보류 중인 커밋을 반영한다. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  listDir.mockImplementation((path: string) =>
    path === "/vault/journal/daily"
      ? Promise.resolve([folder(String(lastYear)), folder(String(thisYear))])
      : Promise.resolve([]),
  );
  readFile.mockImplementation((path: string) =>
    path in CONTENT
      ? Promise.resolve(CONTENT[path])
      : Promise.reject(new Error(`no such file: ${path}`)),
  );
  useFileStore.setState({ rootPath: "/vault" });
  useSettingsStore.setState({
    journalDirectory: "journal",
    memoriesMode: "oneline",
  });
  useUIStore.setState({ rightPanelMode: "memories", rightPanelOpen: true });
});

afterEach(() => {
  listDir.mockReset();
  readFile.mockReset();
});

describe("Memories 패널의 저널 갱신", () => {
  test("첫 로드에는 자리표시자를 보여 준다 — 보여 줄 카드가 아직 없다", async () => {
    const held = holdReads();
    const { container } = render(<MemoriesPanel />);
    await settle();

    expect(container.querySelector(".memories-loading")).not.toBeNull();

    held.release();
    await settle();
    expect(container.querySelectorAll(".memories-year-card")).toHaveLength(2);
  });

  test("저장이 알린 갱신은 카드를 자리표시자로 갈아치우지 않는다", async () => {
    const { container } = render(<MemoriesPanel />);
    await settle();
    expect(container.querySelectorAll(".memories-year-card")).toHaveLength(2);

    const held = holdReads();
    await act(async () => {
      notifyJournalChanged();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });

    // 갱신이 디스크를 읽는 동안: 카드는 그대로, 자리표시자는 없다.
    expect(container.querySelector(".memories-loading")).toBeNull();
    expect(container.querySelectorAll(".memories-year-card")).toHaveLength(2);

    held.release();
    await settle();
    expect(container.querySelectorAll(".memories-year-card")).toHaveLength(2);
  });
});
