// §350 시스템 폰트 열거 IPC.
import { invoke } from "@tauri-apps/api/core";

import type { SystemFont } from "./types";

/**
 * 열거가 실패했을 때의 목록.
 *
 * 빈 피커를 보여주지 않는다 — 사용자는 그것을 "폰트 설정이 고장났다"로 읽고,
 * 실제로는 번들 서체를 쓸 수 있는 상태다.
 */
const FALLBACK_FONTS: SystemFont[] = [
  {
    hasKorean: true,
    monospaced: false,
    name: "Pretendard Variable",
    weights: [400],
  },
  {
    hasKorean: false,
    monospaced: true,
    name: "JetBrains Mono Variable",
    weights: [400],
  },
  { hasKorean: false, monospaced: false, name: "system-ui", weights: [400] },
  { hasKorean: false, monospaced: false, name: "serif", weights: [400] },
  { hasKorean: false, monospaced: true, name: "monospace", weights: [400] },
];

export interface FontListResult {
  fonts: SystemFont[];
  /**
   * `true` when `fonts` is {@link FALLBACK_FONTS}, not a real enumeration of
   * this machine — the IPC call failed, or it returned nothing.
   *
   * §351 리뷰 Important 2: 이전에는 실패와 빈 결과 둘 다 조용히 같은
   * 폴백 목록으로 떨어져서, 호출자가 "이 머신에 실제로 설치된 목록"과
   * "브라우저를 비우지 않으려는 임시 목록"을 구분할 수 없었다. 폴백 목록은
   * Task 6 브라우저가 비지 않게 하려고 존재할 뿐, 이 머신에 무엇이 없는지에
   * 대한 권위가 아니다 — 그 권위로 쓰면(§351의 가용성 배지) 실제로 설치된
   * 서체를 "이 머신에 없음"이라 단정하는 거짓 배지가 된다.
   */
  isFallback: boolean;
}

export async function listFonts(refresh = false): Promise<FontListResult> {
  try {
    const fonts = await invoke<SystemFont[]>("font_list", { refresh });
    return fonts.length > 0
      ? { fonts, isFallback: false }
      : { fonts: FALLBACK_FONTS, isFallback: true };
  } catch {
    return { fonts: FALLBACK_FONTS, isFallback: true };
  }
}
