// §85 Work Log — today's entry is opened if it exists and created if it does not.
//
// The "exists?" question was asked by catching EVERY `readFile` failure as "no such file",
// so a work log that exists but could not be read (invalid UTF-8, a permission the OS
// refused) was overwritten with the default template — the defect `ensureJournalFile` had,
// closed the same way: only the not-found rejection creates.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createDir, listDir, readFile, writeFile } = vi.hoisted(() => ({
  createDir: vi.fn(async (_path: string) => {}),
  listDir: vi.fn(async (_path: string, _recursive?: boolean) => []),
  readFile: vi.fn(async (_path: string) => ""),
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
}));
// The classifier comes from the real module: a copy here could drift from the prefix
// `ipc/fs.ts` actually checks and exercise a different rule than production.
vi.mock("../../ipc/fs", async () => {
  const actual =
    await vi.importActual<typeof import("../../ipc/fs")>("../../ipc/fs");
  return {
    createDir,
    isFileNotFoundError: actual.isFileNotFoundError,
    listDir,
    readFile,
    writeFile,
  };
});
vi.mock("../../ipc/context", () => ({
  addContext: vi.fn(async (info: unknown) => info),
  getContexts: vi.fn(async () => []),
  getVaultConfig: vi.fn(async () => ({
    workLog: { enabled: true, fileNameFormat: "YYYY-MM-DD", folder: "daily" },
  })),
  removeContext: vi.fn(async () => {}),
  setActiveContext: vi.fn(async () => {}),
  updateContextAlias: vi.fn(async () => {}),
  updateContextColor: vi.fn(async () => {}),
  updateContextLabel: vi.fn(async () => {}),
}));
const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../logger", () => ({ logger }));

import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { createWorkLogForToday } from "../work-log";

const TODAY = "/vault/daily/2026-10-03.md";
// What Tauri rejects `readFile` with — `FsError`'s Display (`src-tauri/src/fs/mod.rs`).
const NOT_FOUND = `파일을 찾을 수 없습니다: ${TODAY}`;
const UNREADABLE = "파일 읽기 실패: stream did not contain valid UTF-8";

describe("createWorkLogForToday", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 3, 9, 0));
    readFile.mockClear();
    writeFile.mockClear();
    logger.error.mockClear();
    useContextStore.setState({
      activeContextId: "ctx-vault",
      contexts: [
        {
          addedAt: 0,
          color: "#3b82f6",
          contextType: "vault",
          id: "ctx-vault",
          label: "vault",
          path: "/vault",
        },
      ],
    });
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates today's work log when it does not exist", async () => {
    readFile.mockRejectedValueOnce(NOT_FOUND);

    await expect(createWorkLogForToday()).resolves.toBe(TODAY);

    expect(writeFile).toHaveBeenCalledWith(
      TODAY,
      expect.stringContaining("# 2026-10-03 Work Log"),
    );
  });

  it("opens today's work log when it exists, without writing it", async () => {
    readFile.mockResolvedValueOnce("# mine\n");

    await expect(createWorkLogForToday()).resolves.toBe(TODAY);

    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toMatchObject([{ filePath: TODAY }]);
  });

  it("raises for a work log it cannot read and leaves it untouched", async () => {
    readFile.mockRejectedValueOnce(UNREADABLE);

    await expect(createWorkLogForToday()).rejects.toBe(UNREADABLE);

    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(TODAY),
      UNREADABLE,
    );
  });
});
