// §276.5 동반 노트 읽기 합류(coalescing). **캐시가 아니다** — 이름의
// "cache"는 in-flight 합류만 가리킨다.
//
// 왜 필요한가: 텍스트 하이라이트 참조는 지금까지 읽기를 0회 했다(display가
// 마크다운에 구워져 있었으니까). 원문 전체를 표시 시점에 그리기로 하면 노트를
// 열 때마다 참조당 파일 읽기가 하나씩 생기고, 같은 PDF를 가리키는 참조 10개는
// 같은 동반 노트를 10번 읽는다. 경로별로 진행 중인 읽기에 합류시키면 동시
// N건이 읽기 1회가 된다.
//
// ‼️ 결과를 캐시하면 안 된다. 동반 노트는 사용자가 직접 편집하는 파일이고
// readCompanionNoteContent는 열린 버퍼를 먼저 본다(pdf-highlight-store.ts) —
// 사용자가 노트에서 하이라이트 문단을 고치는 즉시 다음 표시가 새 텍스트를
// 보여야 한다. 결과를 들고 있으면 참조가 옛 텍스트에 영원히 고정된다. TTL
// 같은 시간 기반 완화책도 쓰지 않는다(같은 결함을 확률적으로 만들 뿐이다).
//
// 합류 키가 blockId가 아니라 **경로**인 이유: 아끼려는 비용은 파일 읽기이고,
// 한 번 읽은 내용에서 blockId별 문단을 뽑는 것은 문자열 연산이다. 같은 노트의
// 서로 다른 blockId 3건도 읽기 1회로 접힌다.
import { findBlockContent } from "../../../utils/editor/block-nav";
import { logger } from "../../../utils/logger";
import { readCompanionNoteContent } from "./pdf-highlight-store";

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
 * 사라진다.
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
  const content = await joinRead(absCompanionPath, read);
  return content === null ? null : findBlockContent(content, blockId);
}

/** 경로 → 진행 중인 읽기. settle과 동시에 비워진다(§ 위 헤더). */
const inFlight = new Map<string, Promise<null | string>>();

/**
 * 진행 중인 읽기가 있으면 그것을, 없으면 새로 시작한 읽기를 돌려준다.
 * 돌려주는 Promise는 절대 reject하지 않는다 — 합류자들이 각자 catch를 달지
 * 않아도 되도록 실패를 여기서 null로 접는다.
 */
function joinRead(
  absCompanionPath: string,
  read: CompanionNoteReader,
): Promise<null | string> {
  const existing = inFlight.get(absCompanionPath);
  if (existing) return existing;

  const started = read(absCompanionPath)
    .catch((err: unknown) => {
      logger.error(
        `[pdf-highlight-ref] failed to read companion note for ref preview: ${absCompanionPath}`,
        err,
      );
      return null;
    })
    .finally(() => {
      inFlight.delete(absCompanionPath);
    });

  inFlight.set(absCompanionPath, started);
  return started;
}
