// §3.3 에디터 본문 이미지의 **표시용** URL.
//
// 왜 원본을 그대로 걸지 않는가: 실측 저널의 한 사진은 16320x12240 = 199.8 MPix인데 본문
// 박스는 ~800px이다. 화면에 필요한 픽셀의 약 400배를 웹뷰가 비트맵으로 들고 있어야 하고
// (RGBA ~800MB), 가로 16320px은 WebKit의 텍스처 한도에 걸려 타일로 쪼개진다. WebKit은 그런
// 비트맵을 오래 붙들지 않으므로, 컴포지팅이 바뀌는 순간(hover 시 `.media-resize-handle`의
// opacity 전환이 그것이다) 다시 래스터화한다 — 그 사이 한 프레임이 배경색으로 나타나는 것이
// "이미지에 마우스를 올리면 잠깐 환해지며 깜박인다"의 정체다.
//
// 실앱에서 확인된 사실 두 가지가 이 진단을 고정한다: 199.8 MPix 사진은 **여러 번 왕복한
// 뒤부터** 깜박이기 시작하고(비트맵이 살아 있는 동안은 조용하다), 같은 문서의
// 297x413 스크린샷은 아무리 왕복해도 깜박이지 않는다.
//
// ‼️ 직렬화는 건드리지 않는다. 마크다운으로 나가는 값은 `node.attrs.src`이고
// (pipeline/transformers/image-transformer.ts), 이 훅은 NodeView가 화면에 무엇을 거는지만
// 바꾼다. 내보내기(HTML/PDF)도 마크다운에서 다시 렌더하므로 원본을 쓴다.
import { useEffect, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import { activeFileDir } from "../../../utils/active-file-dir";
import {
  cachedThumbUrl,
  PREVIEW_MAX_PX,
  resolveThumbUrl,
} from "../../../utils/journal/photo-thumbnail";
import { isRemoteOrData } from "../../../utils/media-src";

/**
 * **원본**의 URL — 프리뷰가 아니다. "원본 보기"(ImageOriginalView)만 쓴다.
 *
 * 이 함수가 따로 있는 이유: 프리뷰로 바꾼 뒤에도 원본에 닿는 길이 하나는 남아 있어야 하고,
 * 그 길이 어디인지가 코드에서 분명해야 한다. 본문 렌더가 이걸 부르면 우리가 없앤 비용이
 * 그대로 돌아온다.
 */
export function originalImageUrl(rawSrc: string): string {
  if (!rawSrc || isRemoteOrData(rawSrc)) return rawSrc;
  const absolutePath = absolutePathOf(rawSrc);
  return absolutePath ? convertFileSrc(absolutePath) : rawSrc;
}

/**
 * 표시할 URL. **준비되기 전에는 null**이다 — 그동안 원본을 걸어 두면 피하려던 디코드를
 * 그대로 치른다("일단 원본, 준비되면 교체"가 완화가 아닌 이유).
 *
 * 원격/데이터 URI는 즉시 그 값을 돌려주므로 기다림이 없다.
 */
export function useImagePreview(rawSrc: string): null | string {
  const [url, setUrl] = useState<null | string>(() => initialUrl(rawSrc));

  useEffect(() => {
    const immediate = initialUrl(rawSrc);
    if (immediate) {
      setUrl(immediate);
      return;
    }
    setUrl(null);

    const absolutePath = absolutePathOf(rawSrc);
    if (!absolutePath) return;

    let alive = true;
    resolveThumbUrl(absolutePath, PREVIEW_MAX_PX).then((r) => {
      if (alive) setUrl(r.url);
    });
    return () => {
      alive = false;
    };
  }, [rawSrc]);

  return url;
}

/**
 * 상대 경로를 현재 파일의 디렉터리에 붙여 절대 경로로 만든다.
 *
 * 활성 탭 기준(§286 관련 함정 포함)은 `active-file-dir.ts`의 `activeFileDir`가 갖는다 —
 * 이미지와 동영상이 같은 규칙으로 상대경로를 풀도록 (§293) 그쪽으로 통합했다.
 */
function absolutePathOf(src: string): null | string {
  if (src.startsWith("/")) return src;
  const dir = activeFileDir();
  return dir ? `${dir}/${src}` : null;
}

/** 기다릴 필요가 없는 경우의 URL(원격·데이터 URI, 또는 이미 캐시된 프리뷰). 없으면 null. */
function initialUrl(rawSrc: string): null | string {
  if (!rawSrc) return null;
  if (isRemoteOrData(rawSrc)) return rawSrc;
  const absolutePath = absolutePathOf(rawSrc);
  if (!absolutePath) return null;
  return cachedThumbUrl(absolutePath, PREVIEW_MAX_PX)?.url ?? null;
}
