// §350/§352 열거 결과의 상태 — 세 개다. 둘로 접으면 하나가 거짓말이 된다.
//
// 왜 이 타입이 있는가: `listFonts()` 는 "이 머신의 진짜 목록"과 "브라우저를
// 비우지 않으려는 폴백 목록"을 `isFallback` 으로 구분해 돌려준다(그 구분이
// §351 리뷰 Important 2 의 결론이다). 그런데 두 소비자가 둘 다
// `result.isFallback ? null : result.fonts` 로 접어서, 폴백이 "아직 로딩 중"과
// 같은 `null` 이 됐다 — 결과는 두 가지 동시 거짓이었다:
//
//   · 열거가 실패하면 목록 창이 **영구히** "서체를 불러오는 중…" 이었다.
//     §350 이 "피커가 비는 일은 없어야 한다"고 못 박은 그 상태다.
//   · `FALLBACK_FONTS` 는 아무 표면에도 닿지 못했다 — `grep` 으로 `src/ipc/font.ts`
//     안에서만 발견된다. 자기 단위 테스트만 만족시키는 목록이었다.
//
// 두 요구(배지는 폴백에 단정하지 않는다 · 피커는 비지 않는다)는 서로 모순이
// 아니다. 두 상태로는 동시에 만족시킬 수 없을 뿐이다. 그래서 셋이다.
import type { FontListResult } from "../../ipc/font";
import type { SystemFont } from "../../ipc/types";

/**
 * `loading` = 아직 모른다 · `fallback` = 읽어 봤지만 이 머신을 대표하지 않는다 ·
 * `ok` = 이 머신의 권위 있는 열거.
 *
 * `fallback` 과 `ok` 는 둘 다 그릴 목록을 들고 있다. 다른 것은 그 목록으로
 * **무엇을 단정할 수 있는지**다.
 */
export type FontListState =
  | { fonts: readonly SystemFont[]; status: "fallback" }
  | { fonts: readonly SystemFont[]; status: "ok" }
  | { status: "loading" };

export type FontListStatus = FontListState["status"];

/**
 * 가용성 판정에 넘길 목록 — `null` 은 "단정하지 말라"는 뜻이다.
 *
 * ‼️ `fallback` 은 `loading` 과 똑같이 `null` 이다. 폴백 목록으로 "이 머신에
 * 없음"을 말하면 실제로 설치된 서체를 없다고 단정하게 되고, 그 거짓 배지를
 * 없애는 것이 §351 배지의 존재 이유였다. 반면 **그릴** 목록으로는 폴백도
 * 쓸모가 있다 — 그래서 그 쓰임은 `FontListState` 를 직접 읽는다.
 */
export function badgeFonts(state: FontListState): null | readonly SystemFont[] {
  return state.status === "ok" ? state.fonts : null;
}

/** IPC 결과를 상태로. `loading` 은 이 함수가 만들 수 없다 — 호출 전의 상태다. */
export function fontListStateFrom(result: FontListResult): FontListState {
  return result.isFallback
    ? { fonts: result.fonts, status: "fallback" }
    : { fonts: result.fonts, status: "ok" };
}
