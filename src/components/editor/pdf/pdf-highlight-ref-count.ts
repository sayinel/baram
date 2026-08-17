// §277.2 이 하이라이트를 가리키는 블록 참조가 문서 몇 곳에 있는가.
//
// 완전 삭제(purgeHighlightById)는 되돌릴 수 없고, 잃는 것은 하이라이트 자체가
// 아니라 **그것을 가리키던 참조들**이다 — 항목이 사라지면 resolveHighlightRef가
// null을 돌려 그 참조들이 마크다운에 구워진 80자 display로 퇴화한다
// (pdf-highlight-sidecar.ts의 deletedAt doc comment 참조). 그러니 확인 문구는
// "몇 개를 끊는지"를 말할 수 있어야 한다.
//
// 세는 방법: 블록 참조는 이미 Rust 링크 인덱스에 들어 있다 — extractor.rs가
// `((target#^id))`를 `link_type: "blockRef"` + `block_id`로 뽑아 둔다. 동반
// 노트를 대상으로 백링크를 받아 blockId가 정확히 일치하는 것만 센다.
//
// ‼️ blockId로 거르는 것이 이 수의 정확도를 지킨다. 인덱스의 키는 파일 stem
// 기반이라(normalizer.rs) `Paper.pdf`와 `highlights/Paper.md`가 같은 키로
// 겹치지만(§278에 적힌 기존 결함), 블록 id는 generateBlockId가 만든 난수라
// 겹치지 않는다 — 그래서 그 충돌이 이 수를 오염시키지 못한다.
import type { BacklinkEntry } from "../../../ipc/types";

import { getBacklinks } from "../../../ipc/link-index";
import { logger } from "../../../utils/logger";

/**
 * @returns 이 blockId를 가리키는 블록 참조의 개수. 셀 수 없으면 **0**.
 *
 * ‼️ 0은 "참조가 없다"가 아니라 "있다고 말할 근거가 없다"이다. 인덱스가 아직
 * 안 돌았을 수도, IPC가 실패했을 수도, 단일 파일 모드라 동반 노트 경로가
 * 없을 수도 있다. 호출부는 이 값이 0일 때 **안전을 약속하는 문구를 쓰면 안
 * 된다** — use-pdf-highlight-write-actions.ts의 onPurgeHighlight가 0/실패를
 * 기본 문구("되돌릴 수 없다")로 떨어뜨리는 이유다.
 */
export async function countHighlightRefs(
  absCompanionPath: null | string,
  blockId: string,
): Promise<number> {
  if (!absCompanionPath) return 0;
  let entries: BacklinkEntry[];
  try {
    entries = await getBacklinks(absCompanionPath);
  } catch (err) {
    // 던지지 않는다 — 개수를 못 세는 것이 완전 삭제를 막을 이유는 아니다.
    // 확인 대화상자는 여전히 뜨고, 문구가 참조 수를 뺀 기본형이 될 뿐이다.
    logger.warn("[pdf-highlight] failed to count refs before purge:", err);
    return 0;
  }
  return entries.filter((e) => e.blockId === blockId && losesPreview(e)).length;
}

/**
 * 이 백링크가 완전 삭제로 **무언가를 잃는가**.
 *
 * 블록 **임베드**(`{{embed ((…#^id))}}`)는 잃지 않는다 — 임베드는 동반 노트의
 * 그 문단을 그대로 그리고, 완전 삭제는 사이드카 항목만 지우므로 그 문단은
 * 남는다. 하이라이트 미리보기(원문 칩·영역 크롭)를 그리는 것은 블록 **참조**
 * 뿐이다: resolveHighlightRef의 유일한 소비자가 usePdfHighlightRefPreview이고,
 * 그것을 쓰는 NodeView는 block-reference-view.tsx 하나다.
 *
 * ‼️ 판정은 "잃는 것으로 안다"가 아니라 **"안 잃는다고 아는 것만 뺀다"**이다.
 * 위험한 방향이 과소 집계이기 때문이다 — 없는 안전을 약속하면 사용자가
 * 되돌릴 수 없는 삭제를 누른다. 그래서 linkType이 비어 있거나 우리가 모르는
 * 값이면 **센다**. 나중에 새 링크 종류가 생겨도 조용히 빠지지 않는다.
 */
function losesPreview(entry: BacklinkEntry): boolean {
  return entry.linkType !== "blockEmbed";
}
