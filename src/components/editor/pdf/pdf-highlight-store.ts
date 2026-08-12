// §277 동반 노트와 사이드카 I/O.
import type { Sidecar } from "./pdf-highlight-sidecar";

import {
  createDir,
  isFileNotFoundError,
  readFile,
  writeFile,
} from "../../../ipc/fs";
import { useFileStore } from "../../../stores/file/file";
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
