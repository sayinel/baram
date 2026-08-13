// §276.5 동반 노트 읽기 합류. **캐시가 아니다** — 파일명의 "cache"는 브리프가
// 지정한 이름이고, 가리키는 것은 in-flight 합류뿐이다(pdf-read-coalesce.ts).
//
// 왜 필요한가: 텍스트 하이라이트 참조는 §276.5 이전까지 동반 노트를 읽지
// 않았다(display가 마크다운에 구워져 있었으니까). 원문 전체를 표시 시점에
// 그리기로 하면 노트를 열 때마다 참조당 읽기가 하나씩 생기고, 같은 PDF를
// 가리키는 참조 10개는 같은 동반 노트를 10번 읽는다.
//
// 합류 키가 blockId가 아니라 **경로**인 이유: 아끼려는 비용은 파일 읽기이고,
// 한 번 읽은 내용에서 blockId별 문단을 뽑는 것은 문자열 연산이다. 같은 노트의
// 서로 다른 blockId 3건도 읽기 1회로 접힌다.
//
// ‼️ 이 합류는 최선노력(best-effort)이다 — 사이드카 쪽과 달리 구조적으로
// 보장되지 않는다. 참조 j가 i에 합류하려면 j의 **사이드카 읽기**가 i의 동반
// 노트 읽기가 끝나기 전에 완료돼야 한다. 사이드카가 클수록 완료 시점이 흩어져
// 새어 나가는 읽기가 늘어난다(최악 = 참조 수). 사이드카 읽기는 모든 참조가
// 같은 tick에 시작하므로 그런 조건이 없다(pdf-sidecar-coalesce.ts).
import { findBlockContent } from "../../../utils/editor/block-nav";
import { readCompanionNoteContent } from "./pdf-highlight-store";
import { createReadCoalescer } from "./pdf-read-coalesce";

/** 주입 지점 — 테스트가 파일 I/O 없이 합류 동작만 관찰하기 위한 것. */
export type CompanionNoteReader = (
  absCompanionPath: string,
) => Promise<null | string>;

/**
 * 동반 노트에서 `^blockId` 문단의 원문을 읽는다. 같은 경로에 대한 읽기가
 * 진행 중이면 그 읽기에 합류하고, settle되는 즉시 맵에서 빠진다 — 그래서
 * 다음 요청은 반드시 파일을 다시 읽는다.
 *
 * 읽지 못했거나 그 blockId가 노트에 없으면 null. **던지지 않는다** — 호출부는
 * 표시 경로(NodeView)라 실패하면 기존 글자 칩으로 떨어지면 그만이고, 여기서
 * 나간 rejection은 main.tsx의 전역 unhandledrejection 핸들러가 삼켜 흔적 없이
 * 사라진다. 실패의 진단 로그는 읽기 함수(readCompanionNoteContent)가 남긴다.
 *
 * `read`는 테스트 주입용이다. 프로덕션 호출부는 넘기지 않는다 — 합류 키가
 * 경로뿐이라, 같은 경로에 서로 다른 reader가 동시에 들어오면 나중 것이 앞선
 * 읽기에 합류해 자기 reader는 쓰이지 않는다.
 */
export async function readCompanionTextCoalesced(
  absCompanionPath: string,
  blockId: string,
  read: CompanionNoteReader = readCompanionNoteContent,
): Promise<null | string> {
  const content = await joinCompanionRead(absCompanionPath, read);
  return content === null ? null : findBlockContent(content, blockId);
}

const joinCompanionRead = createReadCoalescer<string>();
