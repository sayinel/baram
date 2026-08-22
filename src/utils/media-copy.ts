// §297 fix (I-3) 미디어 바이트를 디렉터리에 저장하는 공통 단계.
//
// ‼️ `saveMediaToDocAssets`(video/photo 붙여넣기·드랍)와 `savePhotoToAssets`
// (저널 사진)가 각자 파일명 충돌 처리 없이 바로 `writeBinaryFile`을 불렀다 —
// 같은 초 안에 같은 이름의 미디어 둘을 붙여넣으면 두 번째가 첫 번째를 덮어써
// 두 노드가 같은 파일을 가리키게 된다. OS 드래그 경로(`use-external-drop.ts`)는
// 이미 `listDir` + `resolveNameConflict`로 이 문제를 풀고 있었다 — 같은 기능이
// 진입 표면마다 다른 충돌 정책을 갖고 있던 것. 여기 한 곳에서 고쳐 두 경로
// 모두에 적용한다. `media-assets.ts`가 `journal-photo.ts`의
// `generatePhotoFilename`을 이미 가져다 쓰므로, 반대 방향 의존을 새로 만들지
// 않도록 이 파일은 두 곳 모두가 참조하는 독립 저수준 유틸로 둔다.
import { createDir, listDir, writeBinaryFile } from "../ipc/invoke";
import { resolveNameConflict } from "./path-utils";

/**
 * `bytes`를 `dir`에 `preferredName`으로 저장한다. `dir`에 이미 같은 이름이
 * 있으면 `resolveNameConflict`로 `-1`, `-2`, … 접미사를 붙인다(OS 드래그
 * 경로와 같은 정책). 실제로 쓰인 파일명을 반환한다 — `preferredName`과 다를
 * 수 있다.
 *
 * `createDir`은 이미 존재하는 디렉터리에 대해 에러 없이 성공한다
 * (`tokio::fs::create_dir_all`) — 별도 try/catch가 필요 없다.
 */
export async function copyBytesToDir(
  dir: string,
  preferredName: string,
  bytes: Uint8Array,
): Promise<string> {
  await createDir(dir);

  let existingNames: Set<string>;
  try {
    const entries = await listDir(dir);
    existingNames = new Set(entries.map((e) => e.name));
  } catch {
    existingNames = new Set();
  }

  const filename = resolveNameConflict(preferredName, existingNames);
  await writeBinaryFile(`${dir}/${filename}`, Array.from(bytes));
  return filename;
}
