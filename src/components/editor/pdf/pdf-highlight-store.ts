// §277 동반 노트와 사이드카 I/O.
import type { Sidecar } from "./pdf-highlight-sidecar";

import {
  createDir,
  isFileNotFoundError,
  readFile,
  writeFile,
} from "../../../ipc/fs";
import { useFileStore } from "../../../stores/file/file";
import { findBlockContent } from "../../../utils/editor/block-nav";
import { logger } from "../../../utils/logger";
import { dirname } from "../../../utils/path-utils";
import { parseSidecar } from "./pdf-highlight-sidecar";

/**
 * 하이라이트 하나를 동반 노트에 문단 블록으로 덧붙인다.
 *
 * §273.1 형식: findBlockContent는 ` ^id`로 끝나는 한 줄을 찾고 heading
 * 접두사만 제거한다. 리스트/인용 마커는 프리뷰에 그대로 노출되므로 평문
 * 문단을 쓰고, 문단끼리 합쳐지지 않도록 빈 줄로 분리한다.
 *
 * §277 소유권: 버퍼가 열려 있으면 버퍼가 소유자다. 열린 파일을 디스크에서
 * 고치면 파일 워처가 ConflictModal을 띄운다(use-file-watcher.ts:159) —
 * PDF를 읽는 중에 그것이 뜨면 안 된다. `!== undefined`로 비교하는 이유는
 * 빈 문자열("")도 "열려 있음"이기 때문 — falsy 체크(`!buffered`)로 바꾸면
 * 방금 연 빈 버퍼가 디스크 경로로 잘못 새어 나가 바로 이 태스크가 막으려는
 * ConflictModal을 스스로 띄운다.
 *
 * §277.readFile-fail: `readFile`이 실패하는 이유는 "아직 파일이 없음"뿐이
 * 아니다 — 권한 거부나 UTF-8 디코딩 실패도 같은 rejection으로 온다. 이걸
 * 구분 없이 "새 파일"로 취급하면 이미 N개의 하이라이트가 쌓여 있는 동반
 * 노트를 이 블록 하나짜리 내용으로 통째로 덮어써 버린다 — 되돌릴 수 없는
 * 조용한 데이터 손실이라 §273.4가 사이드카에 요구하는 것과 같은 기준으로
 * 막는다. `isFileNotFoundError`로 진짜 "없음"만 새 파일 경로로 보내고,
 * 그 외의 실패는 로그를 남기고 그대로 던져 기존 내용을 지키기 위해 쓰기를
 * 하지 않는다.
 */
export async function appendHighlightBlock(
  absCompanionPath: string,
  text: string,
  blockId: string,
): Promise<void> {
  const oneLine = text.replace(/\s+/g, " ").trim();
  const block = `${oneLine} ^${blockId}`;

  const store = useFileStore.getState();
  const buffered = store.openFiles.get(absCompanionPath);

  if (buffered !== undefined) {
    store.setFileContent(absCompanionPath, joinBlock(buffered, block));
    return;
  }

  let existing = "";
  try {
    existing = await readFile(absCompanionPath);
  } catch (e) {
    if (!isFileNotFoundError(e)) {
      // 파일은 존재하는데 읽지 못했다 — 이대로 진행하면 기존 하이라이트를
      // 잃는다. 쓰기를 하지 않고 실패를 그대로 알린다.
      logger.error(
        `[pdf-highlight] failed to read existing companion note, aborting append to avoid overwriting it: ${absCompanionPath}`,
      );
      throw e;
    }
    // 아직 없는 파일 — 부모 디렉터리를 만들고 새로 쓴다
    await createDir(dirname(absCompanionPath));
  }
  await writeFile(absCompanionPath, joinBlock(existing, block));
}

/**
 * 동반 노트 파일 전체를 읽는다. 파일이 아직 없으면 null(정상 경로 — 이 PDF에
 * 하이라이트가 하나도 없다).
 *
 * appendHighlightBlock과 같은 이유로 버퍼가 열려 있으면 버퍼를 먼저 본다 —
 * 디스크가 아직 못 받은 최신 편집(사용자가 문단을 고친 경우)을 놓치지
 * 않기 위해서다. §274 M4: 그 외의 읽기 실패(권한 거부, UTF-8 디코딩 실패)는
 * "없음"과 같이 취급하지 않는다 — appendHighlightBlock이 같은 구분을 이미
 * 쓰는 이유와 같다. 조용히 null을 돌리면 호출부(Copy text/Copy reference)가
 * "동반 노트에 이 블록이 없다"로 오인해 로그만 남기고 끝난다 — 실제로는
 * 파일을 못 읽은 것뿐인데도. 여기서 던져서 호출부의 실패 처리(§274 I1)를
 * 타게 한다.
 *
 * §276.5 blockId 추출과 분리해 둔 이유: 참조 프리뷰는 같은 동반 노트에서
 * 서로 다른 blockId를 한꺼번에 읽는다. 파일 읽기 한 번을 여럿이 나눠 쓰려면
 * "파일을 읽는 단계"와 "블록을 뽑는 단계"가 갈라져 있어야 한다
 * (pdf-companion-text-cache.ts).
 */
export async function readCompanionNoteContent(
  absCompanionPath: string,
): Promise<null | string> {
  const store = useFileStore.getState();
  const buffered = store.openFiles.get(absCompanionPath);
  if (buffered !== undefined) return buffered;

  try {
    return await readFile(absCompanionPath);
  } catch (e) {
    if (isFileNotFoundError(e)) return null;
    // §276.5 이 한 줄이 이 실패의 **유일한** 로그다. 표시 경로의 합류
    // 래퍼(pdf-read-coalesce.ts)는 rejection을 null로 접기만 하고 다시 찍지
    // 않는다 — 실패 하나가 로그 두 줄이 되면 원인이 둘로 보인다. 그래서
    // 여기서 원인(e)까지 함께 남긴다.
    logger.error(
      `[pdf-highlight] failed to read companion note: ${absCompanionPath}`,
      e,
    );
    throw e;
  }
}

/**
 * §274 이미 만들어진 하이라이트의 원문을 동반 노트에서 읽어온다. Copy
 * reference/Copy text가 기존 하이라이트를 대상으로 할 때 쓴다 —
 * StoredHighlight에는 색과 위치만 있고 텍스트는 없다(§273.2 참조), 텍스트의
 * 유일한 보관처는 동반 노트의 ` ^id` 문단이다.
 *
 * 읽기 규약(버퍼 우선, 없음 vs 실패 구분)은 readCompanionNoteContent에 있다.
 */
export async function readHighlightBlockText(
  absCompanionPath: string,
  blockId: string,
): Promise<null | string> {
  const content = await readCompanionNoteContent(absCompanionPath);
  return content === null ? null : findBlockContent(content, blockId);
}

/** 사이드카를 읽는다. 없거나 손상되면 null. 버린 항목 수는 로그로 남긴다. */
export async function readSidecar(
  absSidecarPath: string,
): Promise<null | Sidecar> {
  let raw: string;
  try {
    raw = await readFile(absSidecarPath);
  } catch {
    return null; // 아직 하이라이트가 없는 PDF — 정상 경로
  }

  const { sidecar, dropped } = parseSidecar(raw);
  if (dropped > 0) {
    // §273.4 조용한 부분 실패 금지
    logger.warn(
      `[pdf-highlight] dropped ${dropped} malformed highlight(s) from ${absSidecarPath}`,
    );
  }
  if (!sidecar) {
    logger.error(`[pdf-highlight] unreadable sidecar: ${absSidecarPath}`);
  }
  return sidecar;
}

/** 사이드카를 쓴다. 부모 디렉터리가 없으면 만든다. */
export async function writeSidecar(
  absSidecarPath: string,
  sidecar: Sidecar,
): Promise<void> {
  await createDir(dirname(absSidecarPath));
  await writeFile(absSidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`);
}

/** 기존 내용 뒤에 빈 줄 하나를 두고 블록을 붙인다. */
function joinBlock(existing: string, block: string): string {
  const body = existing.replace(/\n+$/, "");
  return body.length === 0 ? `${block}\n` : `${body}\n\n${block}\n`;
}
