// §273 하이라이트 기하 사이드카 — 스키마, 경로 규칙, 손상 내성 파싱.
import type { PdfRect } from "./pdf-highlight-geom";

export const HIGHLIGHT_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Sidecar {
  /** 파생이 아니라 기록 — 규칙이 바뀌거나 노트를 옮겨도 추적이 끊기지 않는다. */
  companion: string;
  highlights: StoredHighlight[];
  pdf: string;
  version: 1;
}

export interface StoredHighlight {
  color: HighlightColor;
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
    Array.isArray(h.rects) &&
    h.rects.length > 0 &&
    h.rects.every(isPdfRect)
  );
}
