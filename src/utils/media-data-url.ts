// §324-e 캡처는 아직 파일이 아니다 — **저장을 누르기 전에는 아무것도 디스크에 닿지 않는다.**
//
// 캡처 창에 떨어뜨리거나 붙여넣은 미디어는 data URL로 문서에 들어가고, 저장 시점에
// 이 모듈이 그것을 실제 파일로 꺼내 참조를 상대경로로 바꾼다. 취소하면 이 함수들이
// 아예 불리지 않으므로 되돌릴 것이 없다.
//
// data URL이어야 하는 이유는 취소만이 아니다. `resolveMediaSrc`(media-src.ts)는
// 상대경로를 `baseDir` 기준으로 푸는데 캡처 편집기는 탭이 아니라 baseDir이 없고,
// 그 자리를 메우던 `activeFileDir()`는 **메인 창의 활성 탭**을 읽는다 — 캡처와 아무
// 상관 없는 문서다. 그래서 `assets/x.png`가 어디서도 풀리지 않아 alt 텍스트만
// 그려졌고, 활성 탭이 우연히 캡처 목적지와 같은 디렉터리일 때만 "가끔" 보였다.
// data URL은 `isRemoteOrData`로 통과되어 baseDir을 아예 묻지 않는 유일한 형태다.
//
// ‼️ 마크다운 치환이 문자열 비교로 충분한 근거: pm→md는 data URL을 **원문 그대로**
// 싣는다. 세 형태를 실측했다 — `![alt](data:image/png;base64,…)`,
// `![alt](data:video/mp4;base64,…)`, 그리고 폭이 지정된 이미지의
// `<img src="data:image/png;base64,…" alt="…" width="640" />`. 셋 다 base64 알파벳
// (`A-Za-z0-9+/=`)에 remark-stringify가 이스케이프하는 문자가 없어 URL이 변형되지
// 않는다. 그래서 마크다운을 파싱해 두 문법을 각각 다루는 대신, 노드에서 얻은
// src 문자열을 그대로 찾아 바꾼다 — 문법이 늘어도 이 코드는 그대로다.
import type { Node as PMNode } from "@tiptap/pm/model";

import { copyBytesToDir } from "./media-copy";
import { isMediaAtom } from "./media-src";

/** 아직 디스크에 없는 미디어 한 건 — 문서 안의 data URL과 그 alt(원본 파일명). */
export interface PendingMedia {
  /** 원본 파일명이 살아남는 유일한 자리. data URL은 이름을 담지 못한다. */
  alt: string;
  /** `data:<mime>;base64,<payload>` — 노드 attrs의 src 원문. */
  src: string;
}

/** `extractPendingMedia`의 결과. */
export interface ExtractedMedia {
  /** data URL이 `assets/…` 상대경로로 바뀐 마크다운. */
  markdown: string;
  /** 실제로 쓰인 상대경로 — 쓰인 순서 그대로. */
  written: string[];
}

/**
 * MIME → 확장자. data URL이 이름을 담지 못하므로 alt에 확장자가 없을 때
 * 파일에 무엇을 붙일지는 여기서만 정한다.
 *
 * `media-src.ts`의 `VIDEO_FILE_EXTENSIONS`나 `path-utils`의 `isImageFile`을
 * 재사용하지 않는 이유: 그 둘은 "확장자 → 종류"에 답하고 이건 반대 방향이다.
 * 아래 fallback이 목록 밖 MIME도 subtype으로 처리하므로 이 표는 **완전할 필요가
 * 없다** — 자주 오는 것들의 관용 표기(`image/jpeg` → `jpg`)를 고정할 뿐이다.
 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

/**
 * base64 data URL만 받는다. `data:text/plain,hi` 같은 비-base64 형태는 우리가
 * 만든 것이 아니므로(FileReader는 언제나 base64를 낸다) 손대지 않는다 — 문서에
 * 손으로 적힌 data URI를 저장할 때마다 파일로 흩뿌리지 않기 위해서다.
 */
const BASE64_DATA_URL_RE =
  /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)?;base64,([a-z0-9+/=]*)$/i;

/**
 * 문서 안에서 아직 디스크에 없는 미디어를 모은다. 같은 src가 여러 번 나오면 한 번만 —
 * 같은 이미지를 두 번 붙여넣었다면 파일도 하나이고 두 참조가 그것을 가리킨다.
 *
 * ‼️ `state.doc`이 아니라 `canonicalDoc(state).doc`을 넘길 것. SyntaxReveal이 커서
 * 아래의 이미지를 리터럴 `![alt](src)` **텍스트**로 펼쳐 두면 그 순간의 `state.doc`에는
 * 미디어 노드가 없어 이 함수가 그것을 놓친다 — 그러면 마크다운에는 data URL이 남는데
 * 파일은 쓰이지 않는다. `serializeLiveDoc`이 직렬화에 쓰는 것과 같은 doc을 봐야 둘의
 * 결론이 어긋나지 않는다.
 */
export function collectPendingMedia(doc: PMNode): PendingMedia[] {
  const seen = new Set<string>();
  const found: PendingMedia[] = [];
  doc.descendants((node) => {
    if (!isMediaAtom(node.type.name)) return;
    const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
    if (!BASE64_DATA_URL_RE.test(src) || seen.has(src)) return;
    seen.add(src);
    found.push({
      alt: typeof node.attrs.alt === "string" ? node.attrs.alt : "",
      src,
    });
  });
  return found;
}

/** base64 data URL → 바이트와 MIME. 형식이 아니거나 base64가 깨졌으면 `null`. */
export function decodeBase64DataUrl(
  src: string,
): null | { bytes: Uint8Array; mime: string } {
  const match = BASE64_DATA_URL_RE.exec(src);
  if (!match) return null;

  let binary: string;
  try {
    binary = atob(match[2]);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // MIME이 생략된 data URL의 기본값은 RFC 2397이 정한 `text/plain`이지만, 여기
  // 오는 것은 언제나 `FileReader.readAsDataURL`이 붙인 실제 MIME이다. 그래도
  // 생략을 만나면 종류를 넘겨짚지 않는다 — 아래 `preferredMediaName`이
  // subtype fallback으로 `plain` 확장자를 붙이고, 그것이 정직한 답이다.
  return { bytes, mime: match[1] ?? "text/plain" };
}

/**
 * 디스크에 쓸 파일명 — **원본 파일명을 지킨다.**
 *
 * alt가 원본 이름이 살아남은 유일한 자리다(data URL은 이름을 담지 못한다).
 * 이것이 없으면 캡처의 이미지가 전부 `image.png`, `image-1.png`으로 떨어져,
 * 노트를 나중에 열었을 때 어느 파일이 무엇이었는지 알 수 없다.
 *
 * 정제 규칙은 `generatePhotoFilename`(journal-photo.ts)의 것을 그대로 따른다 —
 * 저장소에 이미 있는 답이고 §297 보안 리뷰를 거쳤다. 다른 점 둘: 타임스탬프
 * 접두사를 붙이지 않고(캡처는 OS 드래그 경로와 같은 "원본 이름 그대로 + 충돌 시
 * `-1`" 정책이다), 길이 자르기를 정제 **뒤에** 해서 잘린 끝에 `-`가 남지 않게 한다.
 */
export function preferredMediaName(alt: string, mime: string): string {
  const base = alt
    // 확장자처럼 보이는 꼬리만 뗀다. `pearl-2.png` → `pearl-2`,
    // `pearl-2`(드랍 경로의 alt) → 그대로.
    .replace(/\.[a-z0-9]{1,10}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/^-|-$/g, "");
  return `${base || fallbackBase(mime)}.${extensionFor(mime)}`;
}

/**
 * `media`의 각 data URL을 `assetsDir`에 파일로 쓰고, `markdown` 안의 그 URL을
 * 쓰인 파일의 상대경로로 바꾼다.
 *
 * ‼️ 호출 순서는 **추출 먼저, 노트 쓰기 나중**이다. 반대로 하면 추출이 실패했을 때
 * 존재하지 않는 파일을 가리키는 참조가 노트에 남는다 — 이 작업이 없애려는 결함이
 * 저장 시점으로 옮겨 갈 뿐이다. 그래서 여기서는 실패를 삼키지 않고 던진다:
 * 호출부는 노트를 쓰지 않고 다이얼로그를 열어 둔 채 본문을 지킨다.
 *
 * 파일마다 **순차적으로 await**한다. `copyBytesToDir`는 호출마다 독립적으로
 * `listDir`을 읽으므로 동시에 부르면 둘 다 같은 스냅샷을 보고 같은 이름을 골라
 * 나중 것이 먼저 것을 덮어쓴다(그 함수의 ‼️ 주석이 이 계약을 호출부에 지운다).
 */
export async function extractPendingMedia(
  markdown: string,
  media: readonly PendingMedia[],
  assetsDir: string,
): Promise<ExtractedMedia> {
  let out = markdown;
  const written: string[] = [];

  for (const item of media) {
    const decoded = decodeBase64DataUrl(item.src);
    if (!decoded) {
      // 조용히 건너뛰지 않는다. 건너뛰면 이 data URL이 노트에 그대로 실리고,
      // 태스크 모드에서는 그 거대한 문자열이 plain-text 태스크 목록의 한 줄이 된다.
      throw new Error("extractPendingMedia: media payload is not valid base64");
    }
    const filename = await copyBytesToDir(
      assetsDir,
      preferredMediaName(item.alt, decoded.mime),
      decoded.bytes,
    );
    const relative = `assets/${filename}`;
    out = out.split(item.src).join(relative);
    written.push(relative);
  }

  return { markdown: out, written };
}

/** 이름이 하나도 남지 않았을 때의 마지막 수단. 종류만은 정직하게 말한다. */
function fallbackBase(mime: string): string {
  return mime.toLowerCase().startsWith("video/") ? "video" : "image";
}

/**
 * 표에 없는 MIME은 subtype에서 유도한다 — `image/heic` → `heic`.
 * `x-` 접두사와 `+xml` 같은 suffix는 떼고, 확장자로 쓸 수 없는 모양이면 `bin`.
 */
function extensionFor(mime: string): string {
  const normalized = mime.toLowerCase();
  const known = MIME_EXTENSIONS[normalized];
  if (known) return known;
  const subtype = (normalized.split("/")[1] ?? "")
    .replace(/^x-/, "")
    .split("+")[0];
  return /^[a-z0-9]{1,10}$/.test(subtype) ? subtype : "bin";
}
