import { beforeEach, describe, expect, it, vi } from "vitest";

// 사이드카 읽기를 목으로 갈아끼운다: 이 파일이 검증하는 것은 "사이드카 내용을
// 어떻게 해석하는가"이지 JSON 파싱이 아니다(그쪽은 pdf-highlight-sidecar.test.ts).
// 덕분에 실제 파서가 만들어 줄 수 없는 입력(rects: [])도 직접 넣어 볼 수 있다.
//
// §276.5 목의 대상은 합류 래퍼(readSidecarCoalesced)다 — 리졸버가 부르는 것이
// 그것이고, 합류 자체는 pdf-sidecar-coalesce.test.ts가 따로 고정한다. 여기서
// 진짜 합류를 통과시키면 테스트마다 바꾸는 mockResolvedValue가 앞선 테스트의
// in-flight 항목에 가려질 수 있다.
const { readSidecarCoalesced } = vi.hoisted(() => ({
  readSidecarCoalesced: vi.fn(),
}));
vi.mock("../pdf-sidecar-coalesce", () => ({ readSidecarCoalesced }));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../../../utils/logger", () => ({ logger }));

const state = { rootPath: "/vault" as null | string };
vi.mock("../../../../stores/file/file", () => ({
  useFileStore: { getState: () => state },
}));

import type { Sidecar, StoredHighlight } from "../pdf-highlight-sidecar";

import { resolveHighlightRef } from "../pdf-highlight-ref-resolve";

const RECT = { h: 40, w: 120, x: 10, y: 20 };

/** 하이라이트 생성 시점의 실제 경로가 그대로 기록된다 — 확장자 대소문자 포함. */
const REAL_PDF_REL_PATH = "papers/Attention.PDF";

/**
 * ‼️ companionPathFor("papers/Attention.PDF")가 만들어 낼 값
 * ("highlights/papers/Attention.md")과 **일부러 다르게** 둔 합성 픽스처다.
 *
 * 실제 앱은 이런 사이드카를 만들지 않는다: `companion`을 쓰는 곳은
 * pdf-highlight-actions.ts:69의 `companionPathFor(input.pdfRelPath)` 하나뿐이고
 * (사이드카를 처음 만들 때만), 노트를 옮기거나 이름을 바꿀 때 이 필드를
 * 갱신하는 핸들러는 없다. 그래서 실제 데이터에서 기록된 값과 파생된 값은
 * 항상 같다 — 즉 **고정하려는 성질이 실제 데이터로는 관찰되지 않는다.**
 * 두 값이 같은 픽스처를 쓰면 리졸버를 파생 방식으로 바꿔치기해도 모든
 * 단정이 통과한다.
 *
 * 고정하는 성질은 "리졸버가 기록된 필드를 **읽는다**"는 것 하나다. 그 성질이
 * 왜 중요한가: §273이 이 필드를 "파생이 아니라 기록"으로 둔 것은, 규칙이
 * 바뀌거나 동반 노트를 따라다니는 기능이 생겼을 때 고칠 곳이 한 군데가
 * 되도록 하기 위해서다. 여기서 파생해 버리면 그때 이 파일도 함께 고쳐야
 * 한다는 사실을 아무도 모른다.
 */
const RECORDED_COMPANION = "highlights/moved/Attention (annotated).md";

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
    companion: RECORDED_COMPANION,
    highlights,
    pdf: REAL_PDF_REL_PATH,
    version: 1,
  };
}

describe("resolveHighlightRef", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.rootPath = "/vault";
    readSidecarCoalesced.mockResolvedValue(sidecarWith(areaHighlight()));
  });

  it("resolves an area highlight to its page and first rect", async () => {
    const resolved = await resolveHighlightRef(
      "highlights/papers/Attention",
      "abc123",
    );

    expect(resolved).toEqual({
      absPdfPath: "/vault/papers/Attention.PDF",
      kind: "area",
      page: 3,
      rect: RECT,
    });
  });

  it("builds the PDF path from sidecar.pdf, keeping the real extension case", async () => {
    // pdfRelPathForHighlightTarget이 돌려주는 값은 확장자가 항상 소문자
    // ".pdf"다 — 그걸 그대로 쓰면 대소문자 구분 파일시스템(Linux)에서
    // "Attention.PDF"를 못 연다. §275.4가 sidecar.pdf를 쓰라는 이유.
    const resolved = await resolveHighlightRef(
      "highlights/papers/Attention",
      "abc123",
    );

    const absPdfPath = resolved?.kind === "area" ? resolved.absPdfPath : null;
    expect(absPdfPath).toBe("/vault/papers/Attention.PDF");
    expect(absPdfPath?.endsWith(".pdf")).toBe(false);
  });

  it("reads the sidecar at the vault-relative path derived from the target", async () => {
    await resolveHighlightRef("highlights/papers/Attention", "abc123");

    expect(readSidecarCoalesced).toHaveBeenCalledWith(
      "/vault/.baram/pdf-highlights/papers/Attention.json",
    );
  });

  it("reads the sidecar exactly once for one ref (both kinds share the read)", async () => {
    // 종류별로 리졸버를 나누면 참조 하나에 사이드카 I/O가 두 번 일어난다.
    await resolveHighlightRef("highlights/papers/Attention", "abc123");

    expect(readSidecarCoalesced).toHaveBeenCalledTimes(1);
  });

  it("returns null without any I/O for an ordinary (non-highlight) block ref", async () => {
    // 문서의 블록 참조 대다수가 이 경로다 — 여기서 사이드카를 읽으면 모든
    // 블록 참조가 디스크를 때린다.
    expect(await resolveHighlightRef("notes/Meeting", "abc123")).toBeNull();
    expect(readSidecarCoalesced).not.toHaveBeenCalled();
  });

  it("returns null in single-file mode (no vault root to resolve against)", async () => {
    state.rootPath = null;

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
    expect(readSidecarCoalesced).not.toHaveBeenCalled();
  });

  it("returns null when the sidecar is missing or unreadable", async () => {
    readSidecarCoalesced.mockResolvedValue(null);

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("returns null when the sidecar no longer has that id (deleted highlight)", async () => {
    readSidecarCoalesced.mockResolvedValue(
      sidecarWith(areaHighlight({ id: "other" })),
    );

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("returns null when the matching AREA highlight carries no rects", async () => {
    readSidecarCoalesced.mockResolvedValue(
      sidecarWith(areaHighlight({ rects: [] })),
    );

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  it("logs and returns null instead of throwing when the sidecar read rejects", async () => {
    // 던지면 main.tsx의 전역 unhandledrejection 핸들러가 preventDefault()로
    // 삼켜 흔적 없이 사라진다.
    //
    // 프로덕션에서 이 분기에 오는 것은 읽기 실패가 아니다 — 합류 래퍼가
    // rejection을 이미 null로 접기 때문이다(그 경우는 위 "missing or
    // unreadable" 테스트가 덮는다). 여기서 지키는 것은 그 뒤의 해석 코드가
    // 던졌을 때(상한 사이드카 객체 등) NodeView가 칩으로 떨어진다는 것이다.
    readSidecarCoalesced.mockRejectedValue(new Error("permission denied"));

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("returns null for a kind that is neither area nor text", async () => {
    // 스키마상 불가능하지만(§273 isStoredHighlight가 두 값만 통과시킨다),
    // 세 번째 종류가 생겼을 때 여기가 조용히 그것을 text로 그리면 안 된다.
    readSidecarCoalesced.mockResolvedValue(
      sidecarWith(
        areaHighlight({ kind: "ink" as unknown as StoredHighlight["kind"] }),
      ),
    );

    expect(
      await resolveHighlightRef("highlights/papers/Attention", "abc123"),
    ).toBeNull();
  });

  describe("text highlights (§276.5)", () => {
    beforeEach(() => {
      readSidecarCoalesced.mockResolvedValue(
        sidecarWith(areaHighlight({ kind: "text" })),
      );
    });

    it("resolves a text highlight to its companion note path", async () => {
      const resolved = await resolveHighlightRef(
        "highlights/papers/Attention",
        "abc123",
      );

      expect(resolved).toEqual({
        absCompanionPath: `/vault/${RECORDED_COMPANION}`,
        kind: "text",
      });
    });

    it("‼️ uses the RECORDED sidecar.companion, never a path derived from the target", async () => {
      // 판별력: `${rootPath}/${companionPathFor(pdfRelPath)}`로 바꿔치기하면
      // 이 단정이 죽는다 — 파생값은 "highlights/papers/Attention.md"다.
      // 오늘의 실제 데이터에서는 두 값이 같아 그 치환이 아무 증상도 내지
      // 않는다는 점이 바로 이 합성 픽스처가 필요한 이유다(위 주석 참조).
      const resolved = await resolveHighlightRef(
        "highlights/papers/Attention",
        "abc123",
      );

      expect(resolved).toMatchObject({
        absCompanionPath: "/vault/highlights/moved/Attention (annotated).md",
      });
      expect(resolved).not.toMatchObject({
        absCompanionPath: "/vault/highlights/papers/Attention.md",
      });
    });

    it("resolves even when rects is empty — text refs never need geometry", async () => {
      // area의 rects 가드가 text까지 잡으면, 좌표가 상한 사이드카에서
      // 읽을 수 있는 원문까지 함께 잃는다.
      readSidecarCoalesced.mockResolvedValue(
        sidecarWith(areaHighlight({ kind: "text", rects: [] })),
      );

      expect(
        await resolveHighlightRef("highlights/papers/Attention", "abc123"),
      ).toMatchObject({ kind: "text" });
    });
  });
});
