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
      // page도 같은 이유로 3이 아니다 — 설계 문서(part15)와 브리프의 stored
      // 픽스처가 둘 다 page: 3을 예시로 쓰므로, 그 값을 그대로 쓰면
      // "page: input.page" → "page: 3" 하드코딩 뮤테이션을 이 테스트 혼자서는
      // 못 잡아낸다(§274 리뷰 M1 — color에서 잡았던 것과 같은 부류의 우연).
      color: "purple",
      kind: "text",
      page: 11,
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
      page: 11,
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
      kind: "text",
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

  // ‼️ §277.1 이 테스트도 예전에는 반대를 단정했다("열린 버퍼면 companion note는
  // 디스크에 안 쓴다"). 그 단정이 데이터 손실을 지켰다 — 그 버퍼를 저장하는
  // 주체가 없어 앱을 닫으면 문단이 사라졌다. 근거는 pdf-highlight-store.ts의
  // appendHighlightBlock 헤더 참조(사용자 vault 실측 포함).
  it("persists BOTH the companion note and the sidecar even when the note is open", async () => {
    openFiles.set(ABS_COMPANION, "Earlier ^p3n8q1\n");

    await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      color: "pink",
      kind: "text",
      page: 1,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 1, w: 1, x: 0, y: 0 }],
      sidecar: null,
      text: "New highlight",
    });

    // 열린 탭도 갱신된다.
    expect(setFileContent).toHaveBeenCalledTimes(1);
    // 그리고 둘 다 디스크에 간다 — 순서는 companion note가 먼저다.
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[0][0]).toBe(ABS_COMPANION);
    expect(writeFile.mock.calls[1][0]).toBe(ABS_SIDECAR);
    expect(writeFile.mock.calls[0][1]).toContain("New highlight ^");
  });

  // §276.3 — 이름은 "createTextHighlight"지만 area도 같은 경로를 재사용한다
  // (companion note에 먼저 쓰고 사이드카에 추가하는 순서는 kind와 무관).
  // input.kind가 그대로 저장 스키마에 반영되는지 확인 — kind: "text"
  // 하드코딩으로 되돌리는 뮤테이션을 이 테스트가 잡는다.
  it("§276.3 writes kind: 'area' when the input says so", async () => {
    const result = await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      color: "yellow",
      kind: "area",
      page: 3,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 200, w: 300, x: 10, y: 10 }],
      sidecar: null,
      text: "Area highlight (page 3)",
    });

    const sidecarCall = writeFile.mock.calls.find((c) => c[0] === ABS_SIDECAR);
    const written = JSON.parse(sidecarCall![1] as string) as Sidecar;
    expect(written.highlights[0].kind).toBe("area");
    expect(result.highlight.kind).toBe("area");
  });

  // §274.3 — "하이라이트 하나를 만들면 사이드카에 정확히 한 항목이 늘어난다"는
  // 단정은 §274.3에서 지운 두 번째 진입점("참조를 먼저 복사하고 색은 나중에")의
  // 테스트에 있었다. 그 진입점은 사라졌지만 단정 자체는 여전히 유효하므로
  // 여기로 옮겨, 사이드카 쓰기 동작이 인라인 과정에서 바뀌지 않았음을 고정한다.
  //
  // 그 위에 쓰기의 **횟수와 순서**까지 함께 건다 — 동반 노트가 먼저,
  // 사이드카가 나중. 뒤집히면 사이드카에 적힌 id를 동반 노트가 아직 갖고 있지
  // 않은 창이 생겨 그 사이 어떤 `((...#^id))`도 대상을 못 찾는다
  // (pdf-highlight-actions.ts doc comment).
  it("§274.3 writes the companion note first and the sidecar second, adding exactly one entry", async () => {
    await createTextHighlight({
      absCompanionPath: ABS_COMPANION,
      absSidecarPath: ABS_SIDECAR,
      color: "green",
      kind: "text",
      page: 5,
      pdfRelPath: "papers/attention.pdf",
      rects: [{ h: 9, w: 9, x: 0, y: 0 }],
      sidecar: null,
      text: "Copied first",
    });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[0][0]).toBe(ABS_COMPANION);
    expect(writeFile.mock.calls[1][0]).toBe(ABS_SIDECAR);

    const written = JSON.parse(writeFile.mock.calls[1][1] as string) as Sidecar;
    expect(written.highlights).toEqual([
      {
        color: "green",
        id: "h7k2m9",
        kind: "text",
        page: 5,
        rects: [{ h: 9, w: 9, x: 0, y: 0 }],
      },
    ]);
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
