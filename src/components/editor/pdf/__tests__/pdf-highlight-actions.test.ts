import { beforeEach, describe, expect, it, vi } from "vitest";

// §277/Task 9 lesson: pdf-highlight-store.ts (which this module calls into)
// imports ipc/fs directly, NOT the ipc/invoke re-export facade — mocking the
// facade instead would leave writeFile/readFile silently unmocked and every
// assertion below vacuous. isFileNotFoundError is pulled through via
// vi.importActual rather than re-implemented, so a drift in the real
// sentinel prefix can't make this suite pass while testing a different
// classification than production.
const { createDir, readFile, writeFile } = vi.hoisted(() => ({
  createDir: vi.fn(async (_path: string) => {}),
  readFile: vi.fn(async (_path: string) => ""),
  writeFile: vi.fn(async (_path: string, _content: string) => {}),
}));
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

vi.mock("../../../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const openFiles = new Map<string, string>();
const setFileContent = vi.fn();
vi.mock("../../../../stores/file/file", () => ({
  useFileStore: { getState: () => ({ openFiles, setFileContent }) },
}));

// generateBlockId is mocked for a deterministic id so the written sidecar
// JSON can be asserted against a known value.
const { generateBlockId } = vi.hoisted(() => ({
  generateBlockId: vi.fn(() => "h7k2m9"),
}));
vi.mock("../../../../pipeline/block-id", () => ({ generateBlockId }));

import type { Sidecar } from "../pdf-highlight-sidecar";

import {
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
} from "../pdf-highlight-actions";

const ABS_COMPANION = "/vault/highlights/papers/attention.md";
const ABS_SIDECAR = "/vault/.baram/pdf-highlights/papers/attention.json";

describe("createTextHighlight", () => {
  beforeEach(() => {
    openFiles.clear();
    setFileContent.mockClear();
    writeFile.mockClear();
    readFile.mockReset();
    readFile.mockResolvedValue("");
    createDir.mockClear();
    generateBlockId.mockClear();
  });

  it("generates an id, appends the companion block, then writes a sidecar with a matching StoredHighlight", async () => {
    const result = await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      // "yellow"는 §7의 HIGHLIGHT_COLORS 기본값과도 겹쳐 하드코딩된 상수를
      // 못 잡아낼 위험이 있다 — 일부러 다른 색을 골라 color 필드가 실제로
      // input.color에서 왔는지(하드코딩이 아닌지)를 이 테스트 하나로도 고정한다.
      color: "purple",
      page: 3,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 12, w: 100, x: 0, y: 0 }],
      sidecar: null,
      text: "Attention mechanisms",
    });

    expect(generateBlockId).toHaveBeenCalledTimes(1);

    // 동반 노트에 블록이 먼저 생겼는지 (appendHighlightBlock 경로)
    expect(writeFile.mock.calls[0][0]).toBe(ABS_COMPANION);
    expect(writeFile.mock.calls[0][1]).toContain(
      "Attention mechanisms ^h7k2m9",
    );

    // writeSidecar가 실제로 쓴 JSON을 파싱해 StoredHighlight 내용을 단정 —
    // writeSidecar가 호출됐다는 사실만으론 내용이 맞다는 증거가 못 된다.
    const sidecarCall = writeFile.mock.calls.find((c) => c[0] === ABS_SIDECAR);
    expect(sidecarCall).toBeDefined();
    const written = JSON.parse(sidecarCall![1] as string) as Sidecar;
    expect(written.highlights).toHaveLength(1);
    expect(written.highlights[0]).toEqual({
      color: "purple",
      id: "h7k2m9",
      kind: "text",
      page: 3,
      rects: [{ h: 12, w: 100, x: 0, y: 0 }],
    });
    expect(written.pdf).toBe("papers/attention.pdf");
    expect(written.companion).toBe("highlights/papers/attention.md");

    expect(result.highlight.id).toBe("h7k2m9");
    expect(result.sidecar.highlights).toHaveLength(1);
  });

  it("appends to an existing sidecar's highlights instead of replacing them", async () => {
    const existing: Sidecar = {
      companion: "highlights/papers/attention.md",
      highlights: [
        {
          color: "green",
          id: "p3n8q1",
          kind: "text",
          page: 1,
          rects: [{ h: 1, w: 1, x: 0, y: 0 }],
        },
      ],
      pdf: "papers/attention.pdf",
      version: 1,
    };

    const result = await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      color: "blue",
      page: 2,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 5, w: 5, x: 1, y: 1 }],
      sidecar: existing,
      text: "Second highlight",
    });

    expect(result.sidecar.highlights).toHaveLength(2);
    expect(result.sidecar.highlights[0].id).toBe("p3n8q1");
    expect(result.sidecar.highlights[1]).toMatchObject({
      color: "blue",
      id: "h7k2m9",
      page: 2,
    });
  });

  it("writes into the open companion buffer instead of disk when it's already open", async () => {
    openFiles.set(ABS_COMPANION, "Earlier ^p3n8q1\n");

    await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      color: "pink",
      page: 1,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 1, w: 1, x: 0, y: 0 }],
      sidecar: null,
      text: "New highlight",
    });

    expect(setFileContent).toHaveBeenCalledTimes(1);
    // 사이드카는 항상 디스크에 쓴다 — 열린 버퍼 경로를 타는 건 companion note뿐.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0]).toBe(ABS_SIDECAR);
  });
});

describe("updateHighlightColor", () => {
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
      {
        color: "green",
        id: "h2",
        kind: "text",
        page: 2,
        rects: [{ h: 1, w: 1, x: 0, y: 0 }],
      },
    ],
    pdf: "papers/attention.pdf",
    version: 1,
  };

  beforeEach(() => {
    writeFile.mockClear();
    createDir.mockClear();
  });

  it("replaces only the matching highlight's color and writes the sidecar", async () => {
    const next = await updateHighlightColor(
      ABS_SIDECAR,
      sidecar,
      "h1",
      "purple",
    );

    expect(next.highlights[0]).toMatchObject({ color: "purple", id: "h1" });
    expect(next.highlights[1]).toMatchObject({ color: "green", id: "h2" });
    expect(writeFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFile.mock.calls[0][1] as string) as Sidecar;
    expect(written.highlights[0].color).toBe("purple");
  });

  it("leaves the sidecar unchanged when the id doesn't match any highlight", async () => {
    const next = await updateHighlightColor(
      ABS_SIDECAR,
      sidecar,
      "missing",
      "blue",
    );
    expect(next.highlights).toEqual(sidecar.highlights);
  });
});

describe("deleteHighlightById", () => {
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
      {
        color: "green",
        id: "h2",
        kind: "text",
        page: 2,
        rects: [{ h: 1, w: 1, x: 0, y: 0 }],
      },
    ],
    pdf: "papers/attention.pdf",
    version: 1,
  };

  beforeEach(() => {
    writeFile.mockClear();
  });

  it("removes only the matching highlight and writes the sidecar", async () => {
    const next = await deleteHighlightById(ABS_SIDECAR, sidecar, "h1");

    expect(next.highlights).toHaveLength(1);
    expect(next.highlights[0].id).toBe("h2");
    const written = JSON.parse(writeFile.mock.calls[0][1] as string) as Sidecar;
    expect(written.highlights.map((h) => h.id)).toEqual(["h2"]);
  });
});
