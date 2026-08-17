// §273 하이라이트 기하 사이드카 — 스키마, 경로 규칙, 손상 내성 파싱.
import type { PdfRect } from "./pdf-highlight-geom";

import { unescapeBlockRefTarget } from "../../../pipeline/block-id";

export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** §276.3 "text" | "area" — pulled out once both creation paths need to name it. */
export type HighlightKind = StoredHighlight["kind"];

export interface Sidecar {
  /** 파생이 아니라 기록 — 규칙이 바뀌거나 노트를 옮겨도 추적이 끊기지 않는다. */
  companion: string;
  highlights: StoredHighlight[];
  pdf: string;
  version: 1;
}

export interface StoredHighlight {
  color: HighlightColor;
  /**
   * §277.2 삭제 시각(ISO-8601). **있으면 삭제된 것**이고, 항목 자체는 남는다 —
   * 없으면 살아 있다.
   *
   * 왜 지우지 않는가: 사이드카에는 좌표만 있고 원문은 동반 노트에만 있다
   * (§273.2). 항목을 지우면 `resolveHighlightRef`가 그 자리에서 멈춰
   * (pdf-highlight-ref-resolve.ts) 이 하이라이트를 가리키던 모든 블록 참조가
   * 마크다운에 구워진 80자 `display`로 퇴화한다. 영역 하이라이트는 rect까지
   * 함께 사라져 **원리상 되살릴 수 없다**. 플래그를 세우면 kind·rects·page가
   * 남아 text와 area 참조가 둘 다 온전히 산다.
   *
   * ‼️ 문자열 값 자체를 읽는 곳은 없다 — 판정은 항상 isDeletedHighlight다.
   * 시각을 담는 이유는 나중에 "N일 지난 항목 정리" 같은 정책이 생겼을 때
   * 스키마를 다시 바꾸지 않기 위해서다.
   */
  deletedAt?: string;
  id: string;
  /** "area"는 2차용 자리 — 지금 잡아두면 나중에 스키마 마이그레이션이 없다. */
  kind: "area" | "text";
  /** 1-based 페이지 번호. */
  page: number;
  rects: PdfRect[];
}

/** vault 상대 PDF 경로 → 동반 노트의 vault 상대 경로. */
export function companionPathFor(pdfRelPath: string): string {
  return `highlights/${pdfRelPath.replace(/\.pdf$/i, ".md")}`;
}

/**
 * §277.2 이 하이라이트가 삭제되었는가.
 *
 * 판정을 함수 하나로 모으는 이유: 사이드카를 읽는 소비자가 여덟 곳이고
 * 각자 **다른 답**을 원한다(오버레이는 감춰야 하고 참조 해석은 봐야 한다).
 * `h.deletedAt` 비교를 소비자마다 손으로 쓰면 그 여덟 개가 서로 어긋나도
 * 아무 데서도 안 걸린다.
 */
export function isDeletedHighlight(h: StoredHighlight): boolean {
  return h.deletedAt !== undefined;
}

/**
 * 사이드카를 파싱한다.
 *
 * §273.4 항목 단위 실패: 하이라이트 하나가 스키마에 안 맞는다고 파일 전체를
 * 버리면 사용자는 모든 하이라이트를 잃는다. 나쁜 항목만 버리고 개수를
 * 돌려주어 호출부가 로그를 남기게 한다 (조용한 부분 실패 금지).
 */
export function parseSidecar(raw: string): {
  dropped: number;
  sidecar: null | Sidecar;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { dropped: 0, sidecar: null };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { dropped: 0, sidecar: null };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) return { dropped: 0, sidecar: null };
  if (typeof obj.pdf !== "string" || typeof obj.companion !== "string") {
    return { dropped: 0, sidecar: null };
  }

  const rawList = Array.isArray(obj.highlights) ? obj.highlights : [];
  const highlights = rawList.filter(isStoredHighlight);

  return {
    dropped: rawList.length - highlights.length,
    sidecar: {
      companion: obj.companion,
      highlights,
      pdf: obj.pdf,
      version: 1,
    },
  };
}

/**
 * §275.6 companionPathFor의 역함수 — 블록 참조 target(확장자 없음, ` ((target#^id))`
 * 의 target 그대로)이 `highlights/`로 시작하면 대응하는 PDF의 vault 상대 경로를
 * 복원한다. 그 접두사가 아니면(일반 블록 참조) null — 호출부가 기존 동작으로
 * 떨어지는 신호다.
 *
 * §275.4 CRITICAL-2 target은 use-pdf-highlights.ts가 escapeBlockRefTarget으로
 * `)`·`#`·`|`(및 `%`)를 이스케이프해 둔 채로 들어온다 — "highlights/" 접두사
 * 자체는 그 문자들을 담지 않아 startsWith 판정에는 영향이 없지만, 파일명
 * 부분을 실제 경로로 되돌리려면 반드시 unescapeBlockRefTarget으로 풀어야
 * 한다. 안 풀면 (2017) 같은 흔한 논문 파일명에서 .pdf 경로가 원본과 달라져
 * 조용히 못 찾는다.
 */
export function pdfRelPathForHighlightTarget(target: string): null | string {
  const prefix = "highlights/";
  if (!target.startsWith(prefix)) return null;
  const unescaped = unescapeBlockRefTarget(target);
  return `${unescaped.slice(prefix.length)}.pdf`;
}

/** vault 상대 PDF 경로 → 사이드카의 vault 상대 경로. */
export function sidecarPathFor(pdfRelPath: string): string {
  return `.baram/pdf-highlights/${pdfRelPath.replace(/\.pdf$/i, ".json")}`;
}

function isPdfRect(v: unknown): v is PdfRect {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.w === "number" &&
    typeof r.h === "number"
  );
}

function isStoredHighlight(v: unknown): v is StoredHighlight {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    h.id.length > 0 &&
    (h.kind === "text" || h.kind === "area") &&
    typeof h.page === "number" &&
    h.page >= 1 &&
    HIGHLIGHT_COLORS.includes(h.color as HighlightColor) &&
    // §277.2 없거나 비어 있지 않은 문자열. 다른 모양이면 이 항목을 버린다 —
    // 나쁜 `page`나 나쁜 `rects`와 똑같이 다룬다. 여기서 특별히 관대해지면
    // "삭제 여부를 알 수 없는 하이라이트"라는 세 번째 상태가 생기고, 그 상태를
    // 오버레이·참조 해석·목록이 각자 다르게 해석하게 된다.
    (h.deletedAt === undefined ||
      (typeof h.deletedAt === "string" && h.deletedAt.length > 0)) &&
    Array.isArray(h.rects) &&
    h.rects.length > 0 &&
    h.rects.every(isPdfRect)
  );
}
