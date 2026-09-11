// §351 서체 가용성 판정 — 피커의 배지와 Task 6(§352) 브라우저의 필터가 같은
// 함수를 쓴다.
//
// 컴포넌트 파일이 아니라 여기 두는 이유: 순수 함수를 컴포넌트가 export하면
// 그 함수 하나가 필요한 소비자도 컴포넌트를 import해야 한다 — 이 저장소의
// leaf util 관례(`src/utils/`)와도 어긋난다.
import type { SystemFont } from "../../ipc/types";

import { GENERIC_FAMILIES } from "../editor/quote-font-family";
import { BUNDLED_FAMILY_KEYS } from "./bundled-fonts";

// review Critical 1 — 열거 목록이 아직 신뢰할 수 없는 동안(로딩 중이거나,
// listFonts()가 폴백으로 떨어져 이 머신을 대표하지 않는 동안) 거짓 "없음"을
// 말하지 않는다.
export type FontAvailability = "bundled" | "missing" | "system" | "unknown";

/**
 * 이 이름이 이 머신에서 실제로 렌더되는가.
 *
 * 빈 값은 `bundled` 다 — "설정 없음"은 토큰 스택을 쓴다는 뜻이고 그 스택의 첫
 * 항목이 번들 서체이므로, 사용자에게 "없음"이라고 말하면 거짓이다.
 *
 * `fonts`가 `null`이면 `unknown`을 돌려준다 — 호출자가 열거를 아직 신뢰할 수
 * 없다는 뜻으로 `null`을 넘긴다(로딩 중이거나 `listFonts()`가 폴백으로
 * 떨어졌을 때, §351 리뷰 Critical 1·Important 2). 그 상태에서 "missing"을
 * 말하면 실제로 설치된 서체를 없다고 단정하는 거짓말이 된다.
 *
 * CSS 제네릭 키워드(`serif`·`monospace`·`system-ui` 등, §349
 * `GENERIC_FAMILIES`)는 "설치된 서체"라는 질문 자체가 성립하지 않는다 —
 * 브라우저가 항상 무언가로 해석하므로 `missing`도, 이 머신의 열거에 실제로
 * 있을 리 없으므로 `system`도 거짓이다. 같은 `unknown`으로 묶는다.
 */
export function fontAvailability(
  name: string,
  fonts: null | readonly SystemFont[],
): FontAvailability {
  const key = name.trim().toLowerCase();
  if (key === "") return "bundled";
  if (BUNDLED_FAMILY_KEYS.has(key)) return "bundled";
  if (GENERIC_FAMILIES.has(key)) return "unknown";
  if (fonts === null) return "unknown";
  return fonts.some((f) => f.name.toLowerCase() === key) ? "system" : "missing";
}
