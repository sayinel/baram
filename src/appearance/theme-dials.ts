// §371.1 → §366. 설치된 테마가 **제안하는** 다이얼 값을 병합기의 `theme` 층으로
// 넘겨준다. 순수하고 동기적이다 — hook 이 아니다. `installed-theme-defs.ts` 가
// 같은 이유로 순수한 것과 짝이다: 비동기 디스크 읽기는 훅이 맡고, 변환은 여기서 한다.
//
// ‼️ 커스텀 테마(`ThemeDef`)는 다이얼을 싣지 못한다. 자리가 없기 때문이고
// (`ThemeDef` 는 `id`·`modes`·`name`·`source` 뿐이라 — `src/types/theme.ts` —
// 다이얼을 실을 필드가 그중 하나도 없다), 테마 편집기에 다이얼 저작 UI 를 더하는
// 것은 export(§371.2)와 한 덩어리라 그 둘을 함께 하는 후속 계획이 들여온다.
// (계획 번호를 적지 않는다 — 이 파일이 생긴 커밋이 한 일은 "0096 이 테마 층을
// 더할 것" 이라던 예고들을 고쳐 쓰는 것이었고, 그 일을 실제로 한 것은 0094 다.)
// 그때까지 커스텀 테마를 쓰는 사용자에게 테마 층은 비어 있고, 그것은 오늘과 같은
// 동작이다.

import type { InstalledTheme } from "../themes/theme-install";
import type { DialValues } from "./dials";

/**
 * 테마가 아무 말도 하지 않은 상태. **모듈 상수여야 한다** — 이 함수의 결과는
 * `use-appearance-dials.ts` 의 이펙트 deps 에 들어가므로, 없을 때마다 새 `{}` 를
 * 만들면 그 이펙트가 매 렌더 돌면서 `<html>` 에 같은 값을 다시 쓴다.
 * `installedThemes[id].manifest.dials` 쪽은 스토어 객체의 일부라 이미 안정적이다.
 */
const NO_DIALS: DialValues = {};

/**
 * `themeId` 가 가리키는 설치 테마가 제안하는 다이얼 값. 없으면 빈 층.
 *
 * 값을 다시 검증하지 않는다 — `rebuildManifest` 가 설치 시점에 `DIALS[].parse` 를
 * 통과시킨 것만 저장했고, 그 뒤 `resolveDials` 가 층을 읽을 때 **한 번 더** 같은
 * 관문을 지난다. 여기서 세 번째 관문을 세우면 규칙이 세 곳에 살게 된다.
 *
 * ‼️ 컨테이너 자체를 신뢰하지 않는다. 설정 스토어의 persist 에는 커스텀 `merge:` 가
 * 없어 저장분의 `"installedThemes": null` 이 그대로 state 에 앉고, 그러면
 * `installedThemes[themeId]` 가 TypeError 를 던진다 — 그 호출은 앱 시작마다 도는
 * 렌더 경로 안이라 트리 전체가 언마운트된다. `store.ts` 의 `state.installedThemes ?? {}`
 * 와 `merge.ts` 의 `asDialValues` 가 같은 이유로 같은 방어를 한다. 방어가 **여기**
 * 있어야, 테마 층을 보는 화면마다 각자 갖추지 않고도 전부 지켜진다 — 이 함수를
 * 감싸는 것은 `use-theme-dials.ts` 하나이고, 화면들은 그 훅을 통해서만 이 층에
 * 닿는다(프로덕션 호출부 전수: 2026-09-22 `grep -F themeDialsFor src/` 기준
 * `use-theme-dials.ts` 하나, 나머지는 테스트다).
 */
export function themeDialsFor(
  themeId: string,
  installedThemes: Record<string, InstalledTheme>,
): DialValues {
  if (typeof installedThemes !== "object" || installedThemes === null) {
    return NO_DIALS;
  }
  return installedThemes[themeId]?.manifest.dials ?? NO_DIALS;
}
