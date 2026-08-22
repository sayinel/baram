// §294 최종 게이트 I3 — 소독된 HTML 블록 안의 상대경로 미디어 src 해석.
//
// 왜 필요한가: 거부하고 원문을 보존하는 정책(`pipeline/transformers/media-html-tag.ts`)은
// 표현할 수 없는 태그를 `htmlBlock`으로 떨군다. 파일은 온전해지지만, htmlBlock 뷰는
// src를 손대지 않았기 때문에 `<img src="assets/photo.png" height="200">`처럼 **로컬**
// 이미지가 든 블록이 Tauri 웹뷰에서 아무것도 못 그렸다 — 상대경로는 `asset:`으로
// 바뀌어야 로드된다. 사용자가 보는 결과가 "그려지고 height만 조용히 사라짐"에서
// "파일은 온전한데 화면에 아무것도 없음"으로 바뀌어 있었다. 이제 최악이 "그려지되
// 크기 지정 없음"이다.
//
// ‼️ 문자열이 아니라 **DOM**을 고친다. DOMPurify 전후로 HTML 문자열을 만지면 소독을
// 우회하는 마크업을 다시 집어넣을 수 있다(이 경로는 보안 리뷰가 "거부된 태그의 안전한
// 폴백"으로 지목한 곳이다). 여기서는 이미 소독을 통과해 DOM에 올라온 `img[src]`의
// **속성 값만** 바꾼다 — 노드를 만들지도, 마크업을 파싱하지도 않는다.
import { isRemoteOrData, resolveMediaSrc } from "../../../utils/media-src";

/**
 * `root` 안의 `img[src]`에서 상대·절대 **로컬** 경로만 `asset:` URL로 바꾼다.
 * 원격(http/https)·data URI·이미 해석된 `asset:`는 그대로 둔다.
 *
 * 여러 번 불러도 안전하다(멱등). 호출부가 매 렌더마다 부르기 때문에 그 성질이
 * 필요하다 — 이유는 html-block-view.tsx의 `useLayoutEffect` 주석에 있다.
 */
export function resolveMediaSrcsIn(
  root: ParentNode,
  baseDir: null | string,
): void {
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    // `isRemoteOrData`가 "우리가 해석할 대상이 아니다"의 공용 답이다
    // (utils/media-src.ts) — http(s)와 data URI. `asset:` 검사는 그 술어의 사본이
    // 아니라 **우리 출력에 대한 멱등성 가드**다: convertFileSrc는 macOS/Linux에서
    // `asset://localhost/…`를 내고, 윈도우 표기 `http://asset.localhost/…`는
    // isRemoteOrData가 이미 잡는다.
    //
    // ‼️ 이 `continue`가 하는 일은 **값**이 아니라 **쓰기**를 막는 것이다.
    // `resolveMediaSrc`도 원격·data URI를 그대로 돌려주므로, 이 줄을 지워도 최종
    // src 문자열은 같다(뮤테이션 테스트로 확인 — jsdom에서는 구별되지 않는다).
    // 그런데 호출부는 **매 렌더** 이 함수를 부른다. 같은 값이라도 `setAttribute`로
    // 다시 쓰면 엔진에 따라 원격 이미지 재요청이 걸릴 수 있다. 그래서 값이 아니라
    // 호출 자체를 단정하는 테스트가 이 가드를 고정한다.
    if (!src || isRemoteOrData(src) || src.startsWith("asset:")) continue;
    img.setAttribute("src", resolveMediaSrc(src, baseDir));
  }
}
