// §276.4/§276.5 블록 참조 → 하이라이트 해석. area는 기하를, text는 원문이
// 들어 있는 동반 노트의 경로를 돌려준다.
//
// use-navigation.ts:277-310(Cmd+Click 점프)과 같은 해석을 하지만 결과가
// 다르다 — 저쪽은 "PDF를 열어라"까지만 알면 되고, 여기는 그 영역을 그리기
// 위해 rect까지 필요하다. 그래서 그 코드를 호출하는 대신 같은 규칙을 이
// 파일에 모아 두고, 두 곳이 공유하는 규칙(§275.4 sidecar.pdf 우선)은 아래
// 주석에 근거를 남긴다.
//
// §276.5 두 종류를 한 함수가 판별하는 이유: 사이드카 읽기가 한 번이면
// 된다. 종류별로 리졸버를 나누면 같은 참조 하나에 사이드카 I/O가 두 번
// 일어난다.
import type { PdfRect } from "./pdf-highlight-geom";

import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";
import {
  pdfRelPathForHighlightTarget,
  sidecarPathFor,
} from "./pdf-highlight-sidecar";
import { readSidecar } from "./pdf-highlight-store";

/**
 * 하이라이트 하나를 표시하는 데 필요한 전부.
 *
 * • area — 잘라 그릴 PDF와 그 안의 사각형.
 * • text — 원문 문단이 들어 있는 동반 노트의 절대 경로. 텍스트 자체는 여기서
 *   읽지 않는다: 사이드카에는 좌표만 있고(§273.2), 원문의 유일한 보관처는
 *   동반 노트다. 그 파일 읽기는 합류(coalescing)를 타야 하므로
 *   pdf-companion-text-cache.ts가 맡는다.
 */
export type ResolvedHighlightRef =
  | { absCompanionPath: string; kind: "text" }
  | { absPdfPath: string; kind: "area"; page: number; rect: PdfRect };

/**
 * `((target#^blockId))`가 하이라이트를 가리키면 그 종류와 표시에 필요한
 * 값을 돌려준다. 그 외에는 전부 null — 호출부(NodeView)는 지금과 같은 글자
 * 칩을 그린다.
 *
 * null이 되는 경우와 각각의 이유:
 * • `highlights/` 접두사가 아님 — 평범한 블록 참조. 문서의 대다수가 이쪽이라
 *   가장 먼저 걸러 사이드카 I/O를 아예 하지 않는다.
 * • rootPath 없음 — 단일 파일 모드. 사이드카의 절대 경로를 만들 수 없다.
 * • 사이드카에 그 id가 없음 — 지워진 하이라이트.
 * • area인데 rects가 비었음 — 스키마상 최소 1개지만 방어적으로 본다.
 * • kind가 area도 text도 아님 — 스키마상 불가능하지만(§273 isStoredHighlight가
 *   두 값만 통과시킨다) 방어적으로 본다. 나중에 세 번째 종류가 생겼을 때
 *   여기가 조용히 그것을 text로 그리면 안 된다.
 *
 * ‼️ area의 절대 경로는 `sidecar.pdf`로 조립한다(§275.4). pdfRelPathForHighlightTarget이
 * 돌려준 값은 companionPathFor의 대소문자 무시 치환 때문에 확장자가 항상
 * 소문자 ".pdf"다 — "Paper.PDF"를 대소문자 구분 파일시스템에서 열지 못한다.
 * sidecar.pdf는 하이라이트 생성 시점의 실제 경로를 그대로 기록해 둔 값이다
 * (use-navigation.ts:282-297이 같은 이유로 같은 선택을 한다).
 *
 * ‼️ text의 동반 노트 경로도 같은 이유로 `sidecar.companion`이다 — 여기서
 * companionPathFor로 다시 파생하면 안 된다. §273이 그 필드를 "파생이 아니라
 * 기록"으로 둔 이유가 이것이고(사용자가 동반 노트를 옮기거나 이름을 바꿔도
 * 추적이 끊기지 않는다), 파생 경로는 위의 대소문자 문제까지 그대로 물려받는다.
 */
export async function resolveHighlightRef(
  target: string,
  blockId: string,
): Promise<null | ResolvedHighlightRef> {
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
    if (!hit) return null;

    if (hit.kind === "text") {
      return {
        absCompanionPath: `${rootPath}/${sidecar.companion}`,
        kind: "text",
      };
    }

    if (hit.kind !== "area") return null;

    const rect = hit.rects[0];
    if (!rect) return null;

    return {
      absPdfPath: `${rootPath}/${sidecar.pdf}`,
      kind: "area",
      page: hit.page,
      rect,
    };
  } catch (err) {
    // 던지지 않는다 — NodeView가 글자 칩으로 떨어지면 그만이고, 여기서 나간
    // rejection은 main.tsx의 전역 unhandledrejection 핸들러가 preventDefault()로
    // 삼켜 조용히 사라진다.
    logger.error("[pdf-highlight-ref] failed to resolve highlight ref:", err);
    return null;
  }
}
