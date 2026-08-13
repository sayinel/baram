import { beforeEach, describe, expect, it, vi } from "vitest";

// readSidecar를 목으로 갈아끼운다: 이 파일이 검증하는 것은 "사이드카 내용을
// 어떻게 해석하는가"이지 JSON 파싱이 아니다(그쪽은 pdf-highlight-sidecar.test.ts).
// 덕분에 실제 파서가 만들어 줄 수 없는 입력(rects: [])도 직접 넣어 볼 수 있다.
const { readSidecar } = vi.hoisted(() => ({ readSidecar: vi.fn() }));
vi.mock("../pdf-highlight-store", () => ({ readSidecar }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

const state = { rootPath: "/vault" as null | string };
vi.mock("../../../../stores/file/file", () => ({
  useFileStore: { getState: () => state },
}));

import type { Sidecar, StoredHighlight } from "../pdf-highlight-sidecar";

import { resolveAreaHighlightRef } from "../pdf-area-ref-resolve";

const RECT = { h: 40, w: 120, x: 10, y: 20 };

/** 하이라이트 생성 시점의 실제 경로가 그대로 기록된다 — 확장자 대소문자 포함. */
const REAL_PDF_REL_PATH = "papers/Attention.PDF";

function areaHighlight(over: Partial<StoredHighlight> = {}): StoredHighlight {
  return {
    color: "yellow",
    id: "abc123",
    kind: "area",
    page: 3,
    rects: [RECT],
    ...over,
  };
}

function sidecarWith(...highlights: StoredHighlight[]): Sidecar {
  return {
    companion: "highlights/papers/Attention.md",
    highlights,
    pdf: REAL_PDF_REL_PATH,
    version: 1,
  };
}

describe("resolveAreaHighlightRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rootPath = "/vault";
    readSidecar.mockResolvedValue(sidecarWith(areaHighlight()));
  });

  it("resolves an area highlight to its page and first rect", async () => {
    const resolved = await resolveAreaHighlightRef(
      "highlights/papers/Attention",
      "abc123",
    );

    expect(resolved).toEqual({
      absPdfPath: "/vault/papers/Attention.PDF",
      page: 3,
      rect: RECT,
    });
  });

  it("builds the PDF path from sidecar.pdf, keeping the real extension case", async () => {
    // pdfRelPathForHighlightTarget이 돌려주는 값은 확장자가 항상 소문자
    // ".pdf"다 — 그걸 그대로 쓰면 대소문자 구분 파일시스템(Linux)에서
    // "Attention.PDF"를 못 연다. §275.4가 sidecar.pdf를 쓰라는 이유.
    const resolved = await resolveAreaHighlightRef(
      "highlights/papers/Attention",
      "abc123",
    );

    expect(resolved?.absPdfPath).toBe("/vault/papers/Attention.PDF");
    expect(resolved?.absPdfPath.endsWith(".pdf")).toBe(false);
  });

  it("reads the sidecar at the vault-relative path derived from the target", async () => {
    await resolveAreaHighlightRef("highlights/papers/Attention", "abc123");

    expect(readSidecar).toHaveBeenCalledWith(
      "/vault/.baram/pdf-highlights/papers/Attention.json",
    );
  });

  it("returns null without any I/O for an ordinary (non-highlight) block ref", async () => {
    // 문서의 블록 참조 대다수가 이 경로다 — 여기서 사이드카를 읽으면 모든
    // 블록 참조가 디스크를 때린다.
    expect(await resolveAreaHighlightRef("notes/Meeting", "abc123")).toBeNull();
    expect(readSidecar).not.toHaveBeenCalled();
  });

  it("returns null in single-file mode (no vault root to resolve against)", async () => {
    state.rootPath = null;

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
    expect(readSidecar).not.toHaveBeenCalled();
  });

  it("returns null when the sidecar is missing or unreadable", async () => {
    readSidecar.mockResolvedValue(null);

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("returns null when the sidecar no longer has that id (deleted highlight)", async () => {
    readSidecar.mockResolvedValue(sidecarWith(areaHighlight({ id: "other" })));

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("returns null for a TEXT highlight so it keeps rendering as the text chip", async () => {
    // ‼️ 판별력: kind === "area" 검사를 지우면 텍스트 하이라이트가 그 줄의
    // 좁은 띠 이미지로 바뀌어 읽을 수 없게 된다.
    readSidecar.mockResolvedValue(sidecarWith(areaHighlight({ kind: "text" })));

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("returns null when the matching highlight carries no rects", async () => {
    readSidecar.mockResolvedValue(sidecarWith(areaHighlight({ rects: [] })));

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("logs and returns null instead of throwing when the read fails", async () => {
    // 던지면 main.tsx의 전역 unhandledrejection 핸들러가 preventDefault()로
    // 삼켜 흔적 없이 사라진다.
    readSidecar.mockRejectedValue(new Error("permission denied"));

    expect(
      await resolveAreaHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
