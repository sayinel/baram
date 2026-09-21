// §366 세 층 병합. 결과는 값이 아니라 `{ value, origin }` 이다 — 출처를 여기서
// 잃으면 설정 UI 의 배지도 되돌리기도 만들 수 없고, 나중에 소급할 방법이 없다
// (스펙 0055 §366.2).

import type { DialId, DialValue, DialValues } from "./dials";

import { DIALS } from "./dials";

export type DialOrigin = "default" | "theme" | "user";

export interface ResolvedDial {
  readonly origin: DialOrigin;
  readonly value: DialValue;
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
  // 층 컨테이너 자체를 신뢰하지 않는다. `config.json`은 웹뷰가 임의 키로 쓸 수
  // 있고, persist 옵션에 커스텀 `merge:`가 없어 zustand의 기본 얕은 병합이
  // `"appearanceOverrides": null` 을 그대로 state 에 앉힌다 — `theme[id]`가
  // `null[id]`가 되어 TypeError 를 던진다(그 값은 앱 시작마다 도는 effect 안이라
  // 트리 전체가 언마운트된다). `store.ts`가 `installedThemes`에 이미 쓰는
  // `?? {}` 관용구와 같은 방어를 여기서 한다 — 호출부 셋(과 이후 매니페스트를
  // 더하는 0096)이 각자 갖추는 대신 병합기 하나가 갖춰야 전부가 지켜진다.
  const themeLayer = asDialValues(theme);
  const userLayer = asDialValues(user);
  const out = {} as Record<DialId, ResolvedDial>;
  for (const dial of DIALS) {
    const id = dial.id;
    let resolved: ResolvedDial = {
      origin: "default",
      value: dial.defaultValue,
    };
    // 층 순서가 곧 우선순위다. 파싱에 실패한 층은 말하지 않은 것으로 친다.
    const themeValue = dial.parse(themeLayer[id]);
    if (themeValue !== undefined) {
      resolved = { origin: "theme", value: themeValue };
    }
    const userValue = dial.parse(userLayer[id]);
    if (userValue !== undefined) {
      resolved = { origin: "user", value: userValue };
    }
    out[id] = resolved;
  }
  return out;
}

/** 비객체(무엇보다 `null`)만 `{}`로 바꾼다 — 스칼라·문자열은 인덱싱해도
 *  `undefined`라 이미 무해하지만(`dial.parse`가 그 값을 그대로 버린다),
 *  "객체가 아니면 `{}`"가 규칙을 말하고 시험하기 더 간단하다. */
function asDialValues(layer: DialValues): DialValues {
  return typeof layer === "object" && layer !== null ? layer : {};
}
