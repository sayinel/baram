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
 *
 * ‼️ §297 fix (I-3 concurrency, final-gate Important #1): 이 함수 **자체는**
 * 동시 호출에 안전하지 않다 — 매 호출이 독립적으로 `listDir`을 읽으므로,
 * `await` 없이 같은 `dir`에 같은 `preferredName`으로 두 번 부르면 둘 다 같은
 * 스냅샷을 보고 같은 이름을 고른다. 이 함수는 **한 번의 호출**만 책임진다;
 * 여러 파일을 다루는 호출부(`drop-handler.ts`의 두 루프)가 파일마다
 * **순차적으로 await**해서 경합을 없앤다 — OS 드래그 경로
 * (`use-external-drop.ts`)가 처음부터 그렇게 하고 있었다. 이 함수에 누적
 * `Set`을 받는 매개변수를 더하지 않은 이유: 호출부를 순차화하는 것으로
 * 충분하고, 그쪽이 실제로 겪는 유일한 동시 호출 패턴(한 번의 드랍/붙여넣기
 * 루프)을 정확히 덮는다.
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
