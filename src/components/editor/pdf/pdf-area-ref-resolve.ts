// §276.4 블록 참조 → 영역 하이라이트 기하 해석.
//
// use-navigation.ts:277-310(Cmd+Click 점프)과 같은 해석을 하지만 결과가
// 다르다 — 저쪽은 "PDF를 열어라"까지만 알면 되고, 여기는 그 영역을 그리기
// 위해 rect까지 필요하다. 그래서 그 코드를 호출하는 대신 같은 규칙을 이
// 파일에 모아 두고, 두 곳이 공유하는 규칙(§275.4 sidecar.pdf 우선)은 아래
// 주석에 근거를 남긴다.
import type { PdfRect } from "./pdf-highlight-geom";

import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";
import {
  pdfRelPathForHighlightTarget,
  sidecarPathFor,
} from "./pdf-highlight-sidecar";
import { readSidecar } from "./pdf-highlight-store";

/** 영역 하이라이트 하나를 잘라 그리는 데 필요한 전부. */
export interface ResolvedAreaRef {
  absPdfPath: string;
  /** 1-based. */
  page: number;
  rect: PdfRect;
}

/**
 * `((target#^blockId))`가 **영역** 하이라이트를 가리키면 그 기하를 돌려준다.
 * 그 외에는 전부 null — 호출부(NodeView)는 지금과 같은 글자 칩을 그린다.
 *
 * null이 되는 경우와 각각의 이유:
 * • `highlights/` 접두사가 아님 — 평범한 블록 참조. 문서의 대다수가 이쪽이라
 *   가장 먼저 걸러 사이드카 I/O를 아예 하지 않는다.
 * • rootPath 없음 — 단일 파일 모드. 사이드카의 절대 경로를 만들 수 없다.
 * • 사이드카에 그 id가 없음 — 지워진 하이라이트.
 * • `kind !== "area"` — 텍스트 하이라이트 참조는 글자로 보여야 한다(§276.4
 *   범위 밖). 이 검사가 빠지면 텍스트 하이라이트가 그 줄의 좁은 띠 이미지로
 *   바뀌어 읽을 수 없게 된다.
 * • rects가 비었음 — 스키마상 최소 1개지만 방어적으로 본다.
 *
 * ‼️ 절대 경로는 `sidecar.pdf`로 조립한다(§275.4). pdfRelPathForHighlightTarget이
 * 돌려준 값은 companionPathFor의 대소문자 무시 치환 때문에 확장자가 항상
 * 소문자 ".pdf"다 — "Paper.PDF"를 대소문자 구분 파일시스템에서 열지 못한다.
 * sidecar.pdf는 하이라이트 생성 시점의 실제 경로를 그대로 기록해 둔 값이다
 * (use-navigation.ts:282-297이 같은 이유로 같은 선택을 한다).
 */
export async function resolveAreaHighlightRef(
  target: string,
  blockId: string,
): Promise<null | ResolvedAreaRef> {
  const pdfRelPath = pdfRelPathForHighlightTarget(target);
  if (!pdfRelPath) return null;

  const { rootPath } = useFileStore.getState();
  if (!rootPath) return null;

  try {
    const sidecar = await readSidecar(
      `${rootPath}/${sidecarPathFor(pdfRelPath)}`,
    );
    if (!sidecar) return null;

    const hit = sidecar.highlights.find((h) => h.id === blockId);
    if (!hit || hit.kind !== "area") return null;

    const rect = hit.rects[0];
    if (!rect) return null;

    return { absPdfPath: `${rootPath}/${sidecar.pdf}`, page: hit.page, rect };
  } catch (err) {
    // 던지지 않는다 — NodeView가 글자 칩으로 떨어지면 그만이고, 여기서 나간
    // rejection은 main.tsx의 전역 unhandledrejection 핸들러가 preventDefault()로
    // 삼켜 조용히 사라진다.
    logger.error("[pdf-area-ref] failed to resolve area highlight ref:", err);
    return null;
  }
}
