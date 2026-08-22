// §294 최종 게이트 I3 — 소독된 HTML 블록 안의 상대경로 미디어 URL 해석.
//
// 왜 필요한가: 거부하고 원문을 보존하는 정책(`pipeline/transformers/media-html-tag.ts`)은
// 표현할 수 없는 태그를 `htmlBlock`으로 떨군다. 파일은 온전해지지만, htmlBlock 뷰는
// URL을 손대지 않았기 때문에 `<img src="assets/photo.png" height="200">`처럼 **로컬**
// 미디어가 든 블록이 Tauri 웹뷰에서 제대로 못 그렸다 — 상대경로는 `asset:`으로
// 바뀌어야 로드된다.
//
// ‼️ 태그별 결과가 다르고, 그 차이가 이 파일의 범위를 정한다. 실제 패키지
// (dompurify 3.4.13)에 앱의 실제 `SANITIZE_CONFIG`를 넣어 측정한 결과:
//   - **살아남는다**: `img`, `video`, `audio`, `source`, `track`, `picture`,
//     `input[src]`. `USE_PROFILES: { html: true }`의 기본 허용 목록에 이미
//     들어 있고 `ADD_TAGS`는 거기에 **더하기만** 한다 — 정의하지 않는다.
//   - **제거된다**: `iframe`(`srcdoc` 포함), `object`, `embed`, `script`, `svg`,
//     그리고 모든 이벤트 핸들러와 `javascript:` URI.
// 그래서 거부된 `<video src="assets/clip.mp4">`는 "안 보이는" 게 아니라 **상대경로를
// 든 살아 있는 플레이어**로 그려졌다 — 빈 검은 상자다. 태그가 보존됐다기보다 앱이
// 고장난 것처럼 보이므로 안 보이는 것보다 나쁘다. 그게 이 파일이 `img`만이 아니라
// URL을 든 모든 요소를 손대는 이유다.
//
// ‼️ 문자열이 아니라 **DOM**을 고친다. DOMPurify 전후로 HTML 문자열을 만지면 소독을
// 우회하는 마크업을 다시 집어넣을 수 있다(이 경로는 보안 리뷰가 "거부된 태그의 안전한
// 폴백"으로 지목한 곳이다). 여기서는 이미 소독을 통과해 DOM에 올라온 요소의 **속성
// 값만** 바꾼다 — 노드를 만들지도, 마크업을 파싱하지도 않는다.
import { isRemoteOrData, resolveMediaSrc } from "../../../utils/media-src";

/**
 * 해석할 URL 속성.
 *
 * ‼️ 요소 이름이 아니라 **속성**으로 고른다. 요소 목록을 적으면 `img`만 고치고
 * `video`를 빠뜨린 이번 결함이 다음 멤버(`audio`·`source`·`track`)에서 그대로
 * 재발한다 — 이 저장소가 반복해서 걸린 "열거한 가드는 다음 멤버를 놓친다" 모양이다.
 * URL 속성은 유한하고 짧으니 그쪽을 열거하는 편이 안전하다.
 *
 * `poster`가 들어 있는 이유: `<video src="clip.mp4" controls poster="p.jpg">`는
 * `controls`·`poster`가 파서 허용 목록 밖이라 **실제로 거부되는** 모양이고(그
 * 테스트가 이미 있다), src만 고치면 멀쩡한 플레이어 위에 깨진 포스터가 남는다.
 *
 * `srcset`은 **일부러 뺐다**: 쉼표로 나뉜 서술자 목록이라 자체 파서가 필요하고,
 * 소독 경로에 파서를 더하는 값이 손으로 쓴 `srcset`의 희소함보다 크지 않다.
 * 살아남긴 하므로 상대 `srcset`은 여전히 해석되지 않는다 — 알려진 한계다.
 */
const URL_ATTRS = ["poster", "src"] as const;

/**
 * `root` 안에서 상대·절대 **로컬** URL만 `asset:` URL로 바꾼다.
 * 원격(http/https)·data URI·이미 해석된 `asset:`는 그대로 둔다.
 *
 * 선택자가 요소를 가리지 않는 것이 안전한 이유: 이 함수는 **소독을 통과한** 서브트리
 * 위에서만 돈다. 거기 남아 있는 요소는 이미 로드가 허용된 것들이고(위 측정 결과),
 * 우리는 그 상대경로를 로드 가능하게 만들 뿐이다.
 *
 * 여러 번 불러도 안전하다(멱등). 호출부가 매 렌더마다 부르기 때문에 그 성질이
 * 필요하다 — 이유는 html-block-view.tsx의 `useLayoutEffect` 주석에 있다.
 */
export function resolveMediaSrcsIn(
  root: ParentNode,
  baseDir: null | string,
): void {
  for (const attr of URL_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const value = el.getAttribute(attr);
      // `isRemoteOrData`가 "우리가 해석할 대상이 아니다"의 공용 답이다
      // (utils/media-src.ts) — http(s)와 data URI. `asset:` 검사는 그 술어의
      // 사본이 아니라 **우리 출력에 대한 멱등성 가드**다: convertFileSrc는
      // macOS/Linux에서 `asset://localhost/…`를 내고, 윈도우 표기
      // `http://asset.localhost/…`는 isRemoteOrData가 이미 잡는다.
      //
      // ‼️ 이 `continue`가 하는 일은 **값**이 아니라 **쓰기**를 막는 것이다.
      // `resolveMediaSrc`도 원격·data URI를 그대로 돌려주므로, 이 줄을 지워도 최종
      // 문자열은 같다(뮤테이션 테스트로 확인 — jsdom에서는 구별되지 않는다).
      // 그런데 호출부는 **매 렌더** 이 함수를 부른다. 같은 값이라도 `setAttribute`로
      // 다시 쓰면 엔진에 따라 원격 리소스 재요청이 걸릴 수 있다. 그래서 값이 아니라
      // 호출 자체를 단정하는 테스트가 이 가드를 고정한다.
      if (!value || isRemoteOrData(value) || value.startsWith("asset:")) {
        continue;
      }
      el.setAttribute(attr, resolveMediaSrc(value, baseDir));
    }
  }
}
