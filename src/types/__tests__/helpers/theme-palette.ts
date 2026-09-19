// §357 테스트 보조 — 내장 테마는 모드를 하나만 선언한다.
//
// `base` 가 `modes` 맵이 되면서 "이 테마의 팔레트"가 두 단계 조회가 됐다. 대비·
// 변수 적용·스토어 테스트가 전부 내장 테마를 재료로 쓰므로 그 조회를 네 파일이
// 각자 적는 대신 여기 한 번 적는다.
//
// 모드가 하나가 아니면 **던진다**. 조용히 첫 모드를 고르면, 쌍을 가진 테마가
// 내장 목록에 들어온 날 그 테마는 절반만 검사받고도 초록으로 통과한다.
import type { ThemeColors, ThemeDef, ThemeMode } from "../../theme";

import { themeModes } from "../../theme";

export function soleMode(theme: ThemeDef): ThemeMode {
  const modes = themeModes(theme);
  if (modes.length !== 1) {
    throw new Error(
      `${theme.id} declares ${modes.length} modes; this helper is for single-mode themes`,
    );
  }
  return modes[0];
}

export function solePalette(theme: ThemeDef): ThemeColors {
  const colors = theme.modes[soleMode(theme)]?.colors;
  if (colors === undefined) throw new Error(`${theme.id} declares no colours`);
  return colors;
}
