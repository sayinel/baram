// §56d Photo Gallery — 갤러리가 자산 하나를 그리는 데 필요한 것들.
//
// 대부분은 원본 대신 쓸 썸네일 URL을 해결하는 일이고, §293부터 동영상의 길이 배지
// 포맷터가 함께 산다 — 컴포넌트 파일에 두면 그 파일이 컴포넌트만 export하지 않게 되어
// Fast Refresh가 깨진다(react-refresh/only-export-components).
//
// 갤러리가 원본을 <img>에 그대로 걸면 브라우저는 100px 칸에 그리려고 해도 원본을 통째로
// 디코드한다(측정: 사진 177장 = RGBA 12.2GB, 유휴 메모리 목표는 100MB). 그래서 여기서
// 나오는 URL이 준비되기 전에는 갤러리가 <img>를 아예 만들지 않는다 — 원본을 "잠깐" 걸어
// 두는 것도 그 디코드를 그대로 치르는 일이다.
import { convertFileSrc } from "@tauri-apps/api/core";

import { photoThumbnail } from "../../ipc/thumbnail";

/** 그리드 칸은 패널 폭에 따라 ~90~160px. 2배 밀도 화면까지 덮는 값. */
export const GALLERY_THUMB_PX = 320;

/**
 * 사진 한 장을 크게 보여주는 두 곳 — 라이트박스와 **에디터 본문** — 이 함께 쓰는 크기.
 *
 * 하나의 값인 것이 요점이다: 둘이 같은 크기를 요구하면 캐시 항목도 하나이므로, 갤러리에서
 * 열어 본 사진을 저널에서 볼 때 다시 만들지 않는다.
 *
 * 2048인 이유: 에디터 본문 폭은 최대 ~900px이고 `.image-figure`가 `max-width: 100%`이라
 * 그보다 크게 표시될 수 없다 — 2배 밀도 화면의 1800 device px를 덮는다. Rust의
 * `MAX_THUMB_PX`와 같은 값이어야 하며, 더 큰 값을 요구하면 백엔드가 조용히 잘라
 * 캐시 키만 갈라진다.
 */
export const PREVIEW_MAX_PX = 2048;

/** 해결된 URL. 원본 폴백이면 `isOriginal`이 참이라 호출자가 큰 디코드를 각오할 수 있다. */
export interface ThumbUrl {
  isOriginal: boolean;
  url: string;
}

/**
 * 초 → `m:ss`(한 시간을 넘으면 `h:mm:ss`). 길이를 알 수 없으면 null.
 *
 * ‼️ null을 돌려주는 경우가 실제로 온다: metadata를 아직 못 읽었으면 `NaN`,
 * 길이를 모르는 스트림이면 `Infinity`다. 그대로 포맷하면 배지에 `NaN:aN`이 뜬다.
 */
export function formatClipDuration(seconds: number): null | string {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // 올림이 아니라 버림 — 14.9초짜리를 "0:15"로 적으면 끝까지 재생해도 도달하지 않는 값이다.
  const total = Math.floor(seconds);
  const ss = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${ss}`
    : `${minutes}:${ss}`;
}

/** absolutePath|maxPx → 결과. 세션 내 재요청은 IPC를 타지 않는다. */
const resolved = new Map<string, ThumbUrl>();
/** 같은 사진을 그리드와 라이트박스가 동시에 요청할 수 있어 진행 중인 약속을 공유한다. */
const inFlight = new Map<string, Promise<ThumbUrl>>();

/**
 * 폴백으로 떨어진 사진들. 개발자 콘솔에서 `__baramThumbStats()`로 읽는다 — 갤러리가 여전히
 * 느릴 때 "썸네일이 안 만들어지고 있다"와 "썸네일은 되는데 다른 게 느리다"를 가르는 값이다.
 */
const failures: { error: string; path: string }[] = [];

/** 테스트 격리용 — 모듈 캐시를 비운다. */
export function _resetThumbCache(): void {
  resolved.clear();
  inFlight.clear();
  failures.length = 0;
}

/** 지금까지의 썸네일 성적. 개발자 콘솔에서 `__baramThumbStats()`로 부른다. */
function thumbStats(): {
  failed: number;
  fromCache: number;
  sampleErrors: string[];
} {
  const values = [...resolved.values()];
  return {
    fromCache: values.filter((v) => !v.isOriginal).length,
    failed: failures.length,
    sampleErrors: [...new Set(failures.map((f) => f.error))].slice(0, 3),
  };
}

if (typeof window !== "undefined") {
  (
    window as unknown as { __baramThumbStats?: typeof thumbStats }
  ).__baramThumbStats = thumbStats;
}

/** 이미 해결돼 있으면 즉시 돌려준다(첫 렌더에서 깜빡임을 없앤다). */
export function cachedThumbUrl(
  absolutePath: string,
  maxPx: number = GALLERY_THUMB_PX,
): null | ThumbUrl {
  return resolved.get(cacheKey(absolutePath, maxPx)) ?? null;
}

export async function resolveThumbUrl(
  absolutePath: string,
  maxPx: number = GALLERY_THUMB_PX,
): Promise<ThumbUrl> {
  const key = cacheKey(absolutePath, maxPx);
  const hit = resolved.get(key);
  if (hit) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = photoThumbnail(absolutePath, maxPx)
    .then((cachePath) => ({
      url: convertFileSrc(cachePath),
      isOriginal: false,
    }))
    .catch((e: unknown) => {
      // ‼️ 반드시 시끄럽게 남긴다. 이 폴백은 **수정 전과 똑같은 화면**을 만든다(원본을 그대로
      // 거는 것이 바로 그 버그였다). 조용히 넘어가면 "고쳤는데 그대로다"와 "고친 코드가
      // 애초에 안 돌았다"를 화면만 보고는 구분할 수 없다.
      failures.push({ error: String(e), path: absolutePath });
      console.warn(
        `[§56d] 썸네일 생성 실패 — 원본으로 폴백합니다(느립니다): ${absolutePath}`,
        e,
      );
      return { url: convertFileSrc(absolutePath), isOriginal: true };
    })
    .then((result) => {
      resolved.set(key, result);
      inFlight.delete(key);
      return result;
    });

  inFlight.set(key, request);
  return request;
}

function cacheKey(absolutePath: string, maxPx: number): string {
  return `${absolutePath}|${maxPx}`;
}
