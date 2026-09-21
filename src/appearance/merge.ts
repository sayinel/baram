// §366 세 층 병합. 결과는 값이 아니라 `{ value, origin }` 이다 — 출처를 여기서
// 잃으면 설정 UI 의 배지도 되돌리기도 만들 수 없고, 나중에 소급할 방법이 없다
// (스펙 0055 §366.2).

import type { DialId, DialValues } from "./dials";

import { DIALS } from "./dials";

export type DialOrigin = "default" | "theme" | "user";

export interface ResolvedDial {
  readonly origin: DialOrigin;
  readonly value: number;
}

/**
 * 기본 → 테마 → 사용자 순으로 덮는다.
 *
 * ‼️ 입력이 아니라 {@link DIALS} 를 순회한다. `theme`·`user` 는 저장분과 매니페스트에서
 * 오는 외부 입력이라, 입력을 순회하면 낯선 키가 결과에 실리고 그것이 그대로
 * `<html>` 인라인 스타일로 간다 — `applyThemeVars` 의 감사 BLOCKER 와 같은 이유다.
 */
export function resolveDials(
  theme: DialValues,
  user: DialValues,
): Record<DialId, ResolvedDial> {
  const out = {} as Record<DialId, ResolvedDial>;
  for (const dial of DIALS) {
    const id = dial.id as DialId;
    let resolved: ResolvedDial = {
      origin: "default",
      value: dial.defaultValue,
    };
    // 층 순서가 곧 우선순위다. 파싱에 실패한 층은 말하지 않은 것으로 친다.
    const themeValue = dial.parse(theme[id]);
    if (themeValue !== undefined) {
      resolved = { origin: "theme", value: themeValue };
    }
    const userValue = dial.parse(user[id]);
    if (userValue !== undefined) {
      resolved = { origin: "user", value: userValue };
    }
    out[id] = resolved;
  }
  return out;
}
