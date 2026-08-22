// §297 문서 옆 assets/에 미디어 바이트를 저장 — data URL 폴백이 없다.
//
// ‼️ 복사가 실패하면 throw한다. 조용히 절대경로로 떨어지면 파일을 옮겼을 때 죽는
// 링크가 되고, data URL로 떨어지면(예: 50MB mp4) 그게 통째로 문서 본문에 박힌다.
// 호출부(드랍·붙여넣기 핸들러)가 실패를 사용자에게 보이는 형태로 알려야 한다.
import { generatePhotoFilename } from "./journal/journal-photo";
import { copyBytesToDir } from "./media-copy";
import { dirname } from "./path-utils";

/**
 * 미디어 바이트를 문서와 같은 디렉터리의 `assets/`에 저장하고, 문서에 삽입할
 * 상대경로(`assets/{filename}`)를 반환한다.
 *
 * 파일명은 저널 사진과 같은 규칙(`generatePhotoFilename`)을 쓴다 —
 * `YYYYMMDD-HHmmss-{sanitized}.{ext}`. §297 fix (I-3): 같은 초에 같은 원본
 * 이름의 미디어 둘을 붙여넣어도(예: 드랍 루프 안에서 순차 처리) 이름이
 * 충돌하면 `copyBytesToDir`가 `-1`, `-2`, …를 붙인다 — 예전에는 두 번째 쓰기가
 * 첫 번째를 덮어써 두 노드가 같은 파일을 가리켰다.
 */
export async function saveMediaToDocAssets(
  bytes: Uint8Array,
  originalName: string,
  docPath: string,
): Promise<string> {
  const assetsDir = `${dirname(docPath)}/assets`;
  const filename = await copyBytesToDir(
    assetsDir,
    generatePhotoFilename(originalName),
    bytes,
  );
  return `assets/${filename}`;
}
