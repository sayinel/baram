// §313 앱 표기 ↔ Tauri 액셀러레이터.
import { describe, expect, it } from "vitest";

import { toAccelerator } from "../capture-shortcut";

describe("toAccelerator", () => {
  it("Mod을 CommandOrControl로 옮긴다", () => {
    // 앱의 `Mod`과 Tauri의 `CommandOrControl`은 뜻이 같다(macOS ⌘, 그 외 Ctrl).
    // 여기서 플랫폼 분기를 하면 두 표기가 각자 플랫폼 판정을 갖게 된다.
    expect(toAccelerator("Mod+Shift+N")).toBe("CommandOrControl+Shift+N");
  });

  it("수식키 순서는 Mod → Shift → Alt로 고정한다", () => {
    expect(toAccelerator("Mod+Shift+Alt+K")).toBe(
      "CommandOrControl+Shift+Alt+K",
    );
  });

  it("Alt만 있어도 등록할 수 있다", () => {
    expect(toAccelerator("Alt+Space")).toBe("Alt+Space");
  });

  it("수식키가 없는 조합은 거절한다", () => {
    // ‼️ 등록되면 OS 전체에서 그 글자를 가로챈다 — 어떤 앱에서도 n을 칠 수 없게 되고,
    // 되돌리러 온 설정 화면에서도 칠 수 없다.
    expect(toAccelerator("N")).toBeNull();
    expect(toAccelerator("Shift+N")).toBeNull();
  });

  it("빈 값은 등록하지 않는다는 뜻이다", () => {
    expect(toAccelerator(null)).toBeNull();
    expect(toAccelerator("")).toBeNull();
    expect(toAccelerator("Mod+Shift")).toBeNull();
  });

  it("문장부호는 Tauri가 아는 이름으로 바꾼다", () => {
    // `CommandOrControl+/`는 Tauri가 파싱하지 못한다 — 등록이 통째로 실패한다.
    expect(toAccelerator("Mod+/")).toBe("CommandOrControl+Slash");
    expect(toAccelerator("Mod+,")).toBe("CommandOrControl+Comma");
  });

  it("화살표는 Arrow 접두사를 뗀다", () => {
    expect(toAccelerator("Mod+ArrowUp")).toBe("CommandOrControl+Up");
  });

  it("글자·숫자·펑션키는 그대로 통과시킨다", () => {
    expect(toAccelerator("Mod+A")).toBe("CommandOrControl+A");
    expect(toAccelerator("Mod+1")).toBe("CommandOrControl+1");
    expect(toAccelerator("Mod+F5")).toBe("CommandOrControl+F5");
  });
});
