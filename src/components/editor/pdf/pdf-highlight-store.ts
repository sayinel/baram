// §277 동반 노트와 사이드카 I/O.
import type { Sidecar } from "./pdf-highlight-sidecar";

import { createDir, readFile, writeFile } from "../../../ipc/fs";
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
  } catch {
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
