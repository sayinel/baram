import { beforeEach, describe, expect, it, vi } from "vitest";

// §277: real definitions live in ipc/fs; ipc/invoke is a re-export facade
// (see src/ipc/invoke.ts). Mocking the facade instead of the module the
// implementation actually imports would leave the mock silently unwired.
const { createDir, readFile, writeFile } = vi.hoisted(() => ({
  createDir: vi.fn(async (_path: string) => {}),
  readFile: vi.fn(async (_path: string) => ""),
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
}));
vi.mock("../../../../ipc/fs", () => ({ createDir, readFile, writeFile }));

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
  readSidecar,
  writeSidecar,
} from "../pdf-highlight-store";

const COMPANION = "/vault/highlights/papers/attention.md";

describe("appendHighlightBlock", () => {
  beforeEach(() => {
    openFiles.clear();
    writeFile.mockClear();
    readFile.mockClear();
    createDir.mockClear();
    setFileContent.mockClear();
    readFile.mockResolvedValue("");
  });

  it("writes to disk when the companion note is not open", async () => {
    readFile.mockRejectedValueOnce(new Error("not found"));

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(setFileContent).not.toHaveBeenCalled();
    expect(writeFile.mock.calls[0][1]).toContain(
      "Attention mechanisms ^h7k2m9",
    );
  });

  it("appends into the open buffer instead of writing to disk", async () => {
    openFiles.set(COMPANION, "Earlier highlight ^p3n8q1\n");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    // 버퍼가 열려 있으면 버퍼가 소유자 — 디스크를 건드리면 ConflictModal이 뜬다
    expect(writeFile).not.toHaveBeenCalled();
    expect(setFileContent).toHaveBeenCalledTimes(1);
    const [path, content] = setFileContent.mock.calls[0];
    expect(path).toBe(COMPANION);
    expect(content).toContain("Earlier highlight ^p3n8q1");
    expect(content).toContain("Attention mechanisms ^h7k2m9");
  });

  it("routes to the buffer even when it is empty, never to disk", async () => {
    // buffered === "" is falsy but !== undefined. A `!buffered` regression
    // would misroute an open-but-empty buffer to disk and pop the very
    // ConflictModal this task exists to prevent.
    openFiles.set(COMPANION, "");

    await appendHighlightBlock(COMPANION, "Attention mechanisms", "h7k2m9");

    expect(writeFile).not.toHaveBeenCalled();
    expect(createDir).not.toHaveBeenCalled();
    expect(setFileContent).toHaveBeenCalledTimes(1);
    const [path, content] = setFileContent.mock.calls[0];
    expect(path).toBe(COMPANION);
    expect(content).toBe("Attention mechanisms ^h7k2m9\n");
  });

  it("separates blocks with a blank line so each is its own paragraph", async () => {
    openFiles.set(COMPANION, "First ^aaa111\n");

    await appendHighlightBlock(COMPANION, "Second", "bbb222");

    const content = setFileContent.mock.calls[0][1] as string;
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
