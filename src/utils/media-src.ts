// §293 미디어 소스 분류 — 확장자와 호스트만 보는 순수 함수.
//
// ‼️ 이 파일이 유일한 열거다. 소비자는 둘이다: md-to-pm(어떤 노드를 만들지)과
// NodeView(어떻게 그릴지). 한쪽만 고치는 사고를 막으려고 목록을 여기 하나만 둔다.
// 확장자나 provider를 더할 때는 여기만 고친다.
//
// ‼️ store-free 유지: 이 파일은 파이프라인(md-to-pm.ts, pm-to-md.ts)이 직접
// import한다. zustand 스토어를 여기서 import하면 그 체인 전체가 파이프라인에
// 딸려 들어온다 — 탭 기준 경로 해석이 필요하면 `./active-file-dir`를 쓸 것.
import { convertFileSrc } from "@tauri-apps/api/core";

import { isImageFile } from "./path-utils";

export type MediaKind = "image" | "video-embed" | "video-file";

/** `![](…)` 형태로 문서에 들어오는 블록 atom 노드 이름 (§295). */
export const MEDIA_ATOM_NAMES: ReadonlySet<string> = new Set([
  "image",
  "video",
]);

/** 재생될 여지가 있는 컨테이너. `.mkv`는 어느 웹뷰에서도 안 되므로 없다 (§293). */
const VIDEO_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "m4v",
  "mov",
  "mp4",
  "ogv",
  "webm",
]);

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VIMEO_ID_RE = /^[0-9]{1,20}$/;

export function classifyMediaSrc(src: string): MediaKind {
  if (!src) return "image";
  if (embedUrlFor(src)) return "video-embed";
  // §324-e data URL은 확장자가 없다 — MIME이 그 자리를 대신한다. 이 줄이 없으면
  // `extensionOf("data:video/mp4;base64,AAAA")`가 마지막 `/` 뒤에서 점을 찾다
  // 실패해 `null`을 내고, 동영상이 image로 분류되어 캡처가 붙여넣은 동영상마다
  // 재생되지 않는 image 노드를 만든다. 캡처는 저장 전까지 미디어를 data URL로
  // 들고 있으므로(`media-data-url.ts`) 이 형태가 처음으로 실제 입력이 되었다.
  const dataMime = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)[;,]/i.exec(src)?.[1];
  if (dataMime) {
    return dataMime.toLowerCase().startsWith("video/") ? "video-file" : "image";
  }
  const ext = extensionOf(src);
  return ext && VIDEO_FILE_EXTENSIONS.has(ext) ? "video-file" : "image";
}

/**
 * provider URL → **우리가 구성한** 임베드 URL. provider가 아니면 null.
 *
 * ‼️ 문서가 iframe src를 직접 주는 경로를 만들지 않는다 (§298). 문서는 id만 주고,
 * id가 문자 클래스를 통과하지 못하면 provider가 아닌 것으로 취급한다.
 */
export function embedUrlFor(src: string): null | string {
  const url = parseHttpUrl(src);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const seg = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return YOUTUBE_ID_RE.test(seg[0] ?? "") ? youtubeEmbed(seg[0]) : null;
  }

  if (host === "youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") ?? "";
      return YOUTUBE_ID_RE.test(id) ? youtubeEmbed(id) : null;
    }
    if (
      (seg[0] === "shorts" || seg[0] === "embed") &&
      YOUTUBE_ID_RE.test(seg[1] ?? "")
    ) {
      return youtubeEmbed(seg[1]);
    }
    return null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = seg[seg.length - 1] ?? "";
    return VIMEO_ID_RE.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }

  return null;
}

export function isMediaAtom(nodeName: string): boolean {
  return MEDIA_ATOM_NAMES.has(nodeName);
}

/**
 * §297 fix (R1) 확장자가 이미지·동영상 둘 중 하나로 **인식되는** 경우에만 true.
 *
 * `classifyMediaSrc`와는 다른 질문에 답한다: 그쪽은 "`![](anything)`이면 어떤
 * 노드로 만들까" — 인식 못 하는 확장자도 image로 떨어지는 것이 마크다운 문맥에서는
 * 옳다(파이프라인 fallback 계약, md-to-pm.ts가 의존한다 — 여기서 바꾸지 않는다).
 * 이 함수는 "이 파일이 애초에 미디어인가"를 묻는다 — OS 드래그 필터
 * (use-external-drop.ts)가 원하는 질문. 같은 fallback으로 답하면 `.pdf`/`.zip`을
 * 드롭했을 때 "image"로 분류돼 assets/에 복사되고 깨진 이미지 노드가 생긴다.
 *
 * 두 목록에서 합성한다 — 세 번째 열거를 새로 만들지 않는다: `isImageFile`
 * (path-utils.ts, 이미지 판정의 유일한 출처)과 이 파일의 비디오 확장자 집합.
 */
export function isMediaFilePath(path: string): boolean {
  return isImageFile(path) || classifyMediaSrc(path) === "video-file";
}

/** 원격 URL과 data URI는 우리 해석의 대상이 아니다 — 그대로 통과시킨다. */
export function isRemoteOrData(src: string): boolean {
  return /^https?:\/\/|^data:/i.test(src);
}

/**
 * Tauri 웹뷰용 src 해석 (§296). 이미지·동영상이 공유한다.
 *  - 원격 URL과 data URI는 통과
 *  - 로컬 경로(절대·상대)는 `asset:` 프로토콜로. 상대경로는 `baseDir` 기준
 */
export function resolveMediaSrc(src: string, baseDir: null | string): string {
  if (!src || isRemoteOrData(src)) return src;
  const absolutePath =
    src.startsWith("/") || !baseDir ? src : `${baseDir}/${src}`;
  return convertFileSrc(absolutePath);
}

/**
 * 확장자만 뽑는다. 쿼리와 프래그먼트는 버린다(`a.mp4?token=1`, `clip.mp4#t=0.1`).
 *
 * ‼️ `.trim()`이 없으면 `clip.mp4 `(뒤 공백)의 확장자가 `"mp4 "`가 되어 동영상이
 * image로 분류된다 (§294 M6). `![](<clip.mp4 >)`로, 그리고 공백으로 끝나는 macOS
 * 파일명으로 실제로 들어온다. 자르는 건 **분류**에서만이다 — `resolveMediaSrc`는
 * 원문 경로를 그대로 넘겨야 그 파일을 실제로 찾는다.
 */
function extensionOf(src: string): null | string {
  const path = src.trim().split("#")[0].split("?")[0];
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : null;
}

function parseHttpUrl(src: string): null | URL {
  if (!/^https?:\/\//i.test(src)) return null;
  try {
    return new URL(src);
  } catch {
    return null;
  }
}

function youtubeEmbed(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}
