import { beforeEach, describe, expect, it, vi } from "vitest";

// §277: real definitions live in ipc/fs; ipc/invoke is a re-export facade
// (see src/ipc/invoke.ts). Mocking the facade instead of the module the
// implementation actually imports would leave the mock silently unwired.
const { createDir, readFile, writeFile } = vi.hoisted(() => ({
  createDir: vi.fn(async (_path: string) => {}),
  readFile: vi.fn(async (_path: string) => ""),
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
}));
// isFileNotFoundError is pulled through from the real module rather than
// re-implemented here — a duplicate could silently drift from the sentinel
// prefix ipc/fs.ts actually checks, which would let this suite pass while
// exercising a different classification than production.
vi.mock("../../../../ipc/fs", async () => {
  const actual =
    await vi.importActual<typeof import("../../../../ipc/fs")>(
      "../../../../ipc/fs",
    );
  return {
    createDir,
    isFileNotFoundError: actual.isFileNotFoundError,
    readFile,
    writeFile,
  };
});

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

const openFiles = new Map<string, string>();
const setFileContent = vi.fn();
vi.mock("../../../../stores/file/file", () => ({
  useFileStore: {
    getState: () => ({ openFiles, setFileContent }),
  },
}));

import type { Sidecar } from "../pdf-highlight-sidecar";

import { findBlockContent } from "../../../../utils/editor/block-nav";
import {
  appendHighlightBlock,
  readHighlightBlockText,
  readSidecar,
  writeSidecar,
} from "../pdf-highlight-store";

const COMPANION = "/vault/highlights/papers/attention.md";

// Shape of the rejection the real Tauri `read_file` command sends: Rust's
// `FsError` variants cross the IPC boundary as their Display string
// (fs_cmd.rs: `.map_err(|e| e.to_string())`), not as an `Error` instance.
// These mirror the two branches `isFileNotFoundError` (src/ipc/fs.ts) must
// tell apart: NotFound vs. the generic ReadError (permission denied, bad
// UTF-8) that Rust maps to on any other read failure.
const NOT_FOUND_REJECTION = `파일을 찾을 수 없습니다: ${COMPANION}`;
const PERMISSION_DENIED_REJECTION =
  "파일 읽기 실패: permission denied (os error 13)";

describe("appendHighlightBlock", () => {
  beforeEach(() => {
    openFiles.clear();
    writeFile.mockClear();
    readFile.mockClear();
    createDir.mockClear();
    setFileContent.mockClear();
    logger.error.mockClear();
    readFile.mockResolvedValue("");
  });

  it("writes to disk when the companion note is not open", async () => {
    readFile.mockRejectedValueOnce(NOT_FOUND_REJECTION);

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    expect(createDir).toHaveBeenCalledWith("/vault/highlights/papers");
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(setFileContent).not.toHaveBeenCalled();
    expect(writeFile.mock.calls[0][1]).toContain(
      "Attention mechanisms ^h7k2m9",
    );
  });

  it("aborts without touching the note when an existing companion note fails to read for a reason other than not-found", async () => {
    // A permission or decode failure on an *existing* note must not be
    // treated as "safe to overwrite as a new file" — that would silently
    // destroy every highlight already in the note.
    readFile.mockRejectedValueOnce(PERMISSION_DENIED_REJECTION);

    await expect(
      appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9"),
    ).rejects.toBe(PERMISSION_DENIED_REJECTION);

    expect(createDir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(setFileContent).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // ‼️ §277.1 이 테스트는 예전에 정확히 반대를 단정했다("버퍼가 소유자이므로
  // 디스크를 건드리지 않는다"). 그 단정이 실제 데이터 손실을 지키고 있었다:
  // 그 버퍼를 저장하는 주체가 없어서(auto-save는 활성 에디터 탭의 Tiptap
  // 내용으로 돈다) 동반 노트가 한 번 열린 뒤로는 모든 하이라이트 문단이
  // 메모리에만 쌓였고 앱 종료와 함께 사라졌다. 사용자 vault 실측: 사이드카
  // 9개 대 동반 노트 문단 1개.
  it("reads the open buffer but STILL writes to disk", async () => {
    openFiles.set(COMPANION, "Earlier highlight ^p3n8q1\n");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [wPath, wContent] = writeFile.mock.calls[0];
    expect(wPath).toBe(COMPANION);
    // 버퍼 내용 위에 이어붙는다 — 디스크가 아직 못 받은 편집을 잃지 않는다.
    expect(wContent).toContain("Earlier highlight ^p3n8q1");
    expect(wContent).toContain("Attention mechanisms ^h7k2m9");
    // 그리고 열린 탭도 같은 내용으로 맞춘다.
    expect(setFileContent).toHaveBeenCalledTimes(1);
    expect(setFileContent.mock.calls[0][1]).toBe(wContent);
  });

  it("treats an open-but-EMPTY buffer as open, and still persists", async () => {
    // buffered === "" is falsy but !== undefined. A `!buffered` regression
    // would read from disk instead of the buffer and lose whatever the user
    // has in that tab.
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    // 버퍼에서 읽었으므로 디스크 읽기도, 디렉터리 생성도 없다.
    expect(readFile).not.toHaveBeenCalled();
    expect(createDir).not.toHaveBeenCalled();
    // 그래도 쓰기는 디스크로 간다.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toBe("Attention mechanisms ^h7k2m9\n");
    expect(setFileContent).toHaveBeenCalledTimes(1);
  });

  it("separates blocks with a blank line so each is its own paragraph", async () => {
    openFiles.set(COMPANION, "First ^aaa111\n");

    await appendHighlightBlock(COMPANION, "Second", "bbb222");

    const content = writeFile.mock.calls[0][1] as string;
    expect(content).toBe("First ^aaa111\n\nSecond ^bbb222\n");
  });

  it("collapses multi-line selection text into one line", async () => {
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "line one\nline  two", "ccc333");

    const content = setFileContent.mock.calls[0][1] as string;
    expect(content).toContain("line one line two ^ccc333");
  });

  it("produces a block findBlockContent can read back verbatim", async () => {
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    const content = setFileContent.mock.calls[0][1] as string;
    expect(findBlockContent(content, "h7k2m9")).toBe("Attention mechanisms");
  });
});

describe("readSidecar", () => {
  const PATH = "/vault/.baram/pdf-highlights/papers/attention.json";

  beforeEach(() => {
    readFile.mockReset();
    logger.warn.mockClear();
    logger.error.mockClear();
  });

  it("returns null when the sidecar file does not exist", async () => {
    readFile.mockRejectedValueOnce(new Error("not found"));

    const result = await readSidecar(PATH);

    expect(result).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns the parsed sidecar for valid JSON without logging", async () => {
    const sidecar: Sidecar = {
      companion: "highlights/papers/attention.md",
      highlights: [
        {
          color: "yellow",
          id: "h1",
          kind: "text",
          page: 1,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
      ],
      pdf: "papers/attention.pdf",
      version: 1,
    };
    readFile.mockResolvedValueOnce(JSON.stringify(sidecar));

    const result = await readSidecar(PATH);

    expect(result).toEqual(sidecar);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs and returns null for unreadable JSON", async () => {
    readFile.mockResolvedValueOnce("not json");

    const result = await readSidecar(PATH);

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("logs the dropped count but still returns the surviving highlights", async () => {
    const raw = JSON.stringify({
      companion: "highlights/papers/attention.md",
      highlights: [
        {
          color: "yellow",
          id: "h1",
          kind: "text",
          page: 1,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
        {
          color: "bogus",
          id: "h2",
          kind: "text",
          page: 1,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
      ],
      pdf: "papers/attention.pdf",
      version: 1,
    });
    readFile.mockResolvedValueOnce(raw);

    const result = await readSidecar(PATH);

    expect(result?.highlights).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("readHighlightBlockText", () => {
  const COMPANION_PATH = "/vault/highlights/papers/attention.md";
  const NOT_FOUND_FOR_COMPANION = `파일을 찾을 수 없습니다: ${COMPANION_PATH}`;

  beforeEach(() => {
    openFiles.clear();
    readFile.mockReset();
    logger.error.mockClear();
  });

  it("reads from the open buffer when the companion note is open", async () => {
    openFiles.set(COMPANION_PATH, "Attention mechanisms ^h7k2m9\n");

    const text = await readHighlightBlockText(COMPANION_PATH, "h7k2m9");

    expect(text).toBe("Attention mechanisms");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads from disk when the companion note is not open", async () => {
    readFile.mockResolvedValueOnce("Attention mechanisms ^h7k2m9\n");

    const text = await readHighlightBlockText(COMPANION_PATH, "h7k2m9");

    expect(text).toBe("Attention mechanisms");
  });

  it("returns null when the block id is missing from the note", async () => {
    readFile.mockResolvedValueOnce("Something else ^other1\n");

    const text = await readHighlightBlockText(COMPANION_PATH, "h7k2m9");

    expect(text).toBeNull();
  });

  it("returns null when the companion note doesn't exist yet", async () => {
    readFile.mockRejectedValueOnce(NOT_FOUND_FOR_COMPANION);

    const text = await readHighlightBlockText(COMPANION_PATH, "h7k2m9");

    expect(text).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("§274 M4: throws (does not silently return null) when the note exists but can't be read for another reason", async () => {
    // Conflating "note missing" with "permission denied / decode failure"
    // would make the caller (Copy text/Copy reference, §274 I1) log a warn
    // and stop as if there were simply no text yet — when the real problem
    // is that the read itself failed. isFileNotFoundError exists precisely
    // to keep these apart (same reasoning as appendHighlightBlock above).
    readFile.mockRejectedValueOnce(PERMISSION_DENIED_REJECTION);

    await expect(readHighlightBlockText(COMPANION_PATH, "h7k2m9")).rejects.toBe(
      PERMISSION_DENIED_REJECTION,
    );
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("writeSidecar", () => {
  beforeEach(() => {
    writeFile.mockClear();
    createDir.mockClear();
  });

  it("creates the parent directory and writes formatted JSON with a trailing newline", async () => {
    const sidecar: Sidecar = {
      companion: "highlights/papers/attention.md",
      highlights: [],
      pdf: "papers/attention.pdf",
      version: 1,
    };
    const path = "/vault/.baram/pdf-highlights/papers/attention.json";

    await writeSidecar(path, sidecar);

    expect(createDir).toHaveBeenCalledWith(
      "/vault/.baram/pdf-highlights/papers",
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, content] = writeFile.mock.calls[0];
    expect(writtenPath).toBe(path);
    expect(content).toBe(`${JSON.stringify(sidecar, null, 2)}\n`);
  });
});
