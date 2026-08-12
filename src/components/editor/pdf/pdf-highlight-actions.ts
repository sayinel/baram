// §274 하이라이트 생성·수정·삭제 오케스트레이션.
// 순수 계산(추가/치환/제거)과 IPC 호출(appendHighlightBlock/writeSidecar)을
// 한 곳에 모아, use-pdf-highlights.ts가 조율 로직 없이 그대로 호출하게 한다.
import type { PdfRect } from "./pdf-highlight-geom";
import type {
  HighlightColor,
  Sidecar,
  StoredHighlight,
} from "./pdf-highlight-sidecar";

import { generateBlockId } from "../../../pipeline/block-id";
import { companionPathFor } from "./pdf-highlight-sidecar";
import { appendHighlightBlock, writeSidecar } from "./pdf-highlight-store";

export interface CreateTextHighlightInput {
  absCompanionPath: string;
  absSidecarPath: string;
  color: HighlightColor;
  /** 1-based 페이지 번호. */
  page: number;
  /** vault 상대 PDF 경로 — 사이드카를 새로 만들 때만 쓴다(companion/pdf 필드). */
  pdfRelPath: string;
  rects: PdfRect[];
  /** 이 PDF에 아직 하이라이트가 하나도 없으면 null. */
  sidecar: null | Sidecar;
  text: string;
}

/**
 * 새 텍스트 선택을 하이라이트로 만든다.
 *
 * 순서가 중요하다 — 동반 노트에 블록을 먼저 만들어야 사이드카에 적을 id가
 * 가리킬 대상이 실제로 존재한다. 블록이 없는데 사이드카만 먼저 써버리면
 * 오버레이는 그려지지만 그 하이라이트를 참조하는 어떤 `((...#^id))`도
 * 대상을 찾지 못하는 상태가 (짧게라도) 생긴다.
 */
export async function createTextHighlight(
  input: CreateTextHighlightInput,
): Promise<{ highlight: StoredHighlight; sidecar: Sidecar }> {
  const blockId = generateBlockId();
  await appendHighlightBlock(input.absCompanionPath, input.text, blockId);

  const highlight: StoredHighlight = {
    color: input.color,
    id: blockId,
    kind: "text",
    page: input.page,
    rects: input.rects,
  };
  const base: Sidecar = input.sidecar ?? {
    companion: companionPathFor(input.pdfRelPath),
    highlights: [],
    pdf: input.pdfRelPath,
    version: 1,
  };
  const sidecar: Sidecar = {
    ...base,
    highlights: [...base.highlights, highlight],
  };
  await writeSidecar(input.absSidecarPath, sidecar);
  return { highlight, sidecar };
}

/**
 * 하이라이트를 사이드카에서 지운다. 동반 노트의 문단(` ^id` 블록)은 건드리지
 * 않는다 — 시각 하이라이트를 지우는 것과 사용자 노트에 이미 적힌 텍스트를
 * 지우는 것은 다른 결정이라, 파괴적인 쪽으로 자동 합치지 않는다.
 */
export async function deleteHighlightById(
  absSidecarPath: string,
  sidecar: Sidecar,
  id: string,
): Promise<Sidecar> {
  const next: Sidecar = {
    ...sidecar,
    highlights: sidecar.highlights.filter((h) => h.id !== id),
  };
  await writeSidecar(absSidecarPath, next);
  return next;
}

/** 기존 하이라이트의 색만 바꿔 사이드카를 다시 쓴다. */
export async function updateHighlightColor(
  absSidecarPath: string,
  sidecar: Sidecar,
  id: string,
  color: HighlightColor,
): Promise<Sidecar> {
  const next: Sidecar = {
    ...sidecar,
    highlights: sidecar.highlights.map((h) =>
      h.id === id ? { ...h, color } : h,
    ),
  };
  await writeSidecar(absSidecarPath, next);
  return next;
}
