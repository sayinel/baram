// §276.5 사이드카 읽기 합류. 합류만 한다 — 캐시하지 않는 이유는
// pdf-read-coalesce.ts 헤더 참조(우리 자신이 하이라이트를 추가/삭제할 때
// 이 파일을 덮어쓴다).
//
// 왜 필요한가: §276.4 이후 `highlights/` 접두사를 가진 블록 참조는 **전부**
// 사이드카를 읽는다 — 텍스트 참조도 포함이다(리졸버가 사이드카를 먼저 읽고
// 나서야 종류를 안다). 논문 하나에서 열 군데를 인용한 노트는 같은 사이드카를
// 열 번 읽고 열 번 JSON.parse + filter(isStoredHighlight)한다. 참조 수가
// 늘수록 이쪽이 동반 노트 읽기보다 비싸다(하이라이트가 많이 쌓인 PDF일수록
// 파일이 크다).
//
// ‼️ 이 합류는 구조적으로 보장된다. 한 문서의 BlockReferenceView는 포털 flush
// 한 번에 모두 마운트되고, 각 effect는 첫 await 전에 동기로
// `readSidecarCoalesced`까지 도달한다 — N건이 같은 tick에 맵에 들어오므로
// 읽기는 1회다. (동반 노트 쪽은 사이드카 해석을 기다린 뒤라 그런 보장이
// 없다 — pdf-companion-text-cache.ts 헤더 참조.)
import type { Sidecar } from "./pdf-highlight-sidecar";

import { readSidecar } from "./pdf-highlight-store";
import { createReadCoalescer } from "./pdf-read-coalesce";

/** 주입 지점 — 테스트가 파일 I/O 없이 합류 동작만 관찰하기 위한 것. */
export type SidecarReader = (absSidecarPath: string) => Promise<null | Sidecar>;

/**
 * 사이드카를 읽는다. 같은 경로에 대한 읽기가 진행 중이면 합류하고, settle
 * 즉시 맵에서 빠진다 — 다음 요청은 반드시 다시 읽는다. 그래서 방금 만든
 * 하이라이트가 참조에서 곧바로 보인다.
 *
 * `readSidecar` 자체의 계약(없거나 손상되면 null, 버린 항목 수는 로그)은
 * 그대로다 — 표시 경로가 아닌 호출부(use-pdf-highlights, use-navigation,
 * 하이라이트 생성)는 지금처럼 `readSidecar`를 직접 부른다. 그쪽은 사용자
 * 동작당 1회라 합류시킬 것이 없다.
 */
export function readSidecarCoalesced(
  absSidecarPath: string,
  read: SidecarReader = readSidecar,
): Promise<null | Sidecar> {
  return joinSidecarRead(absSidecarPath, read);
}

const joinSidecarRead = createReadCoalescer<Sidecar>();
