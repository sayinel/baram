// §274 하이라이트 생성·수정·삭제 오케스트레이션.
// 순수 계산(추가/치환/제거)과 IPC 호출(appendHighlightBlock/writeSidecar)을
// 한 곳에 모아, use-pdf-highlights.ts가 조율 로직 없이 그대로 호출하게 한다.
import type { PdfRect } from "./pdf-highlight-geom";
import type {
  HighlightColor,
  HighlightKind,
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
  /** §276.3 "text" | "area" — 사이드카에 그대로 기록된다. 이름은
   * "createTextHighlight"지만 §276.3부터 area도 이 함수를 그대로 재사용한다 —
   * 동반 노트 문단을 먼저 쓰고 사이드카에 추가하는 순서 자체는 kind와
   * 무관하다. */
  kind: HighlightKind;
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
 * 새 선택을 하이라이트로 만든다 — 동반 노트 블록과 사이드카 항목을 함께
 * 만드는 유일한 진입점이다.
 *
 * ‼️ 순서가 중요하다 — 동반 노트에 블록을 먼저 만들어야 사이드카에 적을 id가
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
    kind: input.kind,
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
 * §277.2 하이라이트를 사이드카에서 **완전히** 지운다 — 되돌릴 수 없다.
 * (§274~§277.1의 `deleteHighlightById`가 하던 일 그대로다.)
 *
 * 이 경로가 필요한 이유는 두 가지다. 아카이브가 무한히 자라면 안 되고,
 * 소프트 삭제만 있으면 "지웠는데 안 지워졌다"가 되어 민감한 내용을 치우려는
 * 사용자에게 줄 답이 없다.
 *
 * ‼️ 그럼에도 동반 노트의 문단은 건드리지 않는다 — 그 문단이 원문의 마지막
 * 사본이고(§273.2), 사용자 노트를 앱이 지우는 것은 별개의 결정이다. 즉 이
 * 함수로도 원문 텍스트는 지워지지 않는다. 호출부(팝업/목록)가 이 사실을
 * 사용자에게 숨기지 않아야 한다.
 */
export async function purgeHighlightById(
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

/**
 * §277.2 삭제 표시를 걷어낸다 — 하이라이트가 페이지에 다시 나타난다.
 *
 * ‼️ `deletedAt: undefined`로 덮어쓰지 않고 **키 자체를 뺀다**. writeSidecar는
 * JSON.stringify를 타므로 undefined 값은 어차피 직렬화에서 사라지지만, 그
 * 사실에 기대면 메모리 상태(setSidecar로 즉시 돌아가는 이 객체)에는 키가 남아
 * `"deletedAt" in h`류의 판정이 파일과 다른 답을 낸다.
 */
export async function restoreHighlightById(
  absSidecarPath: string,
  sidecar: Sidecar,
  id: string,
): Promise<Sidecar> {
  const next: Sidecar = {
    ...sidecar,
    highlights: sidecar.highlights.map((h) => {
      if (h.id !== id) return h;
      // 얕은 복사 후 키를 지운다 — 필드를 손으로 다시 나열하지 않는 것이
      // 중요하다. parseSidecar가 map이 아니라 filter라 알 수 없는 필드가
      // 그대로 실려 오는데(§273 라운드트립 보존), 여기서 열거해 다시 만들면
      // 그 필드들이 복원 한 번에 조용히 사라진다.
      const rest = { ...h };
      delete rest.deletedAt;
      return rest;
    }),
  };
  await writeSidecar(absSidecarPath, next);
  return next;
}

/**
 * §277.2 하이라이트를 **삭제 표시**한다 — 항목은 사이드카에 남는다.
 *
 * 사용자에게는 삭제다: 오버레이가 아카이브를 건너뛰므로 페이지에서 사라진다
 * (use-pdf-highlights.ts). 남기는 것은 그 하이라이트를 가리키는 블록 참조들
 * 때문이다 — 왜 항목을 지우면 그 참조가 복구 불가능하게 퇴화하는지는
 * pdf-highlight-sidecar.ts의 `deletedAt` doc comment에 있다.
 *
 * 동반 노트의 문단(` ^id` 블록)은 여기서도 건드리지 않는다 — §274부터 이어온
 * 경계 그대로다.
 *
 * `deletedAt`을 인자로 받는 이유: 시각을 이 안에서 만들면 테스트가 시계를
 * 가짜로 만들어야 관찰할 수 있다. 호출부가 `new Date().toISOString()`을 준다.
 */
export async function softDeleteHighlightById(
  absSidecarPath: string,
  sidecar: Sidecar,
  id: string,
  deletedAt: string,
): Promise<Sidecar> {
  const next: Sidecar = {
    ...sidecar,
    highlights: sidecar.highlights.map((h) =>
      h.id === id ? { ...h, deletedAt } : h,
    ),
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
