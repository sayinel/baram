// §351 서체 가용성 판정 — 피커의 배지와 Task 6(§352) 브라우저의 필터가 같은
// 함수를 쓴다.
//
// 컴포넌트 파일이 아니라 여기 두는 이유: 순수 함수를 컴포넌트가 export하면
// 그 함수 하나가 필요한 소비자도 컴포넌트를 import해야 한다 — 이 저장소의
// leaf util 관례(`src/utils/`)와도 어긋난다.
import type { SystemFont } from "../../ipc/types";

import { BUNDLED_FAMILY_KEYS } from "./bundled-fonts";

export type FontAvailability = "bundled" | "missing" | "system";

/**
 * 이 이름이 이 머신에서 실제로 렌더되는가.
 *
 * 빈 값은 `bundled` 다 — "설정 없음"은 토큰 스택을 쓴다는 뜻이고 그 스택의 첫
 * 항목이 번들 서체이므로, 사용자에게 "없음"이라고 말하면 거짓이다.
 */
export function fontAvailability(
  name: string,
  fonts: readonly SystemFont[],
): FontAvailability {
  const key = name.trim().toLowerCase();
  if (key === "") return "bundled";
  if (BUNDLED_FAMILY_KEYS.has(key)) return "bundled";
  return fonts.some((f) => f.name.toLowerCase() === key) ? "system" : "missing";
}
