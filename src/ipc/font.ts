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

export async function listFonts(refresh = false): Promise<SystemFont[]> {
  try {
    const fonts = await invoke<SystemFont[]>("font_list", { refresh });
    return fonts.length > 0 ? fonts : FALLBACK_FONTS;
  } catch {
    return FALLBACK_FONTS;
  }
}
