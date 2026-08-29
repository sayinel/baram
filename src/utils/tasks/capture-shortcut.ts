// §313 전역 캡처 단축키 — 앱 내부 표기와 OS 표기 사이의 유일한 번역기.
//
// 앱은 `Mod+Shift+N`을 쓴다(`keybindings/key-utils.ts`). Tauri의 global-shortcut은
// `CommandOrControl+Shift+N`을 쓴다. 두 표기를 각자 만들면 설정 화면이 보여 주는 조합과
// 실제로 등록되는 조합이 갈라지는데, 그 어긋남은 **사용자가 누르기 전까지 보이지 않는다** —
// 화면에는 ⌘⇧N이라 적혀 있고 실제로는 다른 키에 걸려 있는 상태가 된다.
//
// 여기서 거절한 조합은 등록하지 않는다. `register`가 OS 단에서 실패하는 것보다 먼저,
// "이건 전역 단축키가 될 수 없는 조합"을 설정 화면에서 말해 주기 위해서다.

import { parseKeyNotation } from "../../keybindings/key-utils";

/**
 * 앱 표기 → Tauri 액셀러레이터. 전역 단축키가 될 수 없는 조합이면 `null`.
 *
 * `Mod`은 `CommandOrControl`로 간다 — macOS에서 ⌘, 그 외에서 Ctrl. 앱 내부 `Mod`의
 * 뜻과 정확히 같으므로 플랫폼 분기를 여기 둘 필요가 없다.
 */
export function toAccelerator(notation: null | string): null | string {
  if (!notation) return null;
  const { alt, key, mod, shift } = parseKeyNotation(notation);

  // ‼️ 수식키 없는 조합을 등록하면 **다른 앱에서 그 글자를 칠 수 없게 된다.** 전역
  // 단축키는 OS 전체에서 키를 가로채므로, `N` 하나를 등록하면 어떤 앱에서든 n이
  // 사라진다. 되돌리려면 이 설정을 찾아 지워야 하는데, 그 화면에 글자를 칠 수 없다.
  if (!mod && !alt) return null;
  if (!key) return null;

  const parts: string[] = [];
  if (mod) parts.push("CommandOrControl");
  if (shift) parts.push("Shift");
  if (alt) parts.push("Alt");
  parts.push(ACCELERATOR_KEY[key] ?? key);
  return parts.join("+");
}

/**
 * 앱 표기와 이름이 다른 키만 적는다. 글자·숫자·F1~F12는 양쪽이 같아 손댈 것이 없다.
 *
 * 문장부호(`/` `,` …)는 뜻이 통하지 않는다 — Tauri는 `Slash`/`Comma` 같은 이름을 받는다.
 */
const ACCELERATOR_KEY: Record<string, string> = {
  "'": "Quote",
  ",": "Comma",
  "-": "Minus",
  ".": "Period",
  "/": "Slash",
  ";": "Semicolon",
  "=": "Equal",
  "[": "BracketLeft",
  "\\": "Backslash",
  "]": "BracketRight",
  "`": "Backquote",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
};
