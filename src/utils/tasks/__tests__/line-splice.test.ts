import { describe, expect, it } from "vitest";

import { isSameLine, lineAt, removeLine, spliceLine } from "../line-splice";

describe("lineAt", () => {
  it("드러내는 줄에서 종결자를 뗀다", () => {
    expect(lineAt("a\nb\nc\n", 1)).toBe("b");
  });

  it("CRLF의 \\r까지 뗀다 — Rust의 str::lines()와 같은 규칙", () => {
    expect(lineAt("a\r\nb\r\n", 0)).toBe("a");
  });

  it("마지막 줄에 개행이 없어도 읽는다", () => {
    expect(lineAt("a\nb", 1)).toBe("b");
  });

  it("범위를 벗어나면 null", () => {
    expect(lineAt("a\n", 5)).toBeNull();
  });
});

describe("spliceLine", () => {
  it("LF 파일의 한 줄만 바꾼다", () => {
    expect(spliceLine("a\nb\nc\n", 1, "B")).toBe("a\nB\nc\n");
  });

  it("CRLF 파일의 줄바꿈을 보존한다", () => {
    expect(spliceLine("a\r\nb\r\nc\r\n", 1, "B")).toBe("a\r\nB\r\nc\r\n");
  });

  it("혼합 EOL에서 건드리지 않은 줄의 종결자를 그대로 둔다", () => {
    // M1에서 실제 데이터 손실을 낸 형태(fd8dbe7d). 첫 줄만 CRLF다.
    expect(spliceLine("a\r\nb\nc\n", 0, "A")).toBe("A\r\nb\nc\n");
  });

  it("마지막 줄에 개행이 없으면 없는 채로 둔다", () => {
    expect(spliceLine("a\nb", 1, "B")).toBe("a\nB");
  });

  it("마지막 줄에 개행이 있으면 있는 채로 둔다", () => {
    expect(spliceLine("a\nb\n", 1, "B")).toBe("a\nB\n");
  });

  it("범위를 벗어나면 null — 호출자가 stale로 처리한다", () => {
    expect(spliceLine("a\n", 5, "X")).toBeNull();
  });

  it("한글이 섞인 줄에서 바이트가 아니라 문자로 자른다", () => {
    expect(
      spliceLine("- [ ] 보고서 초안\n다음\n", 0, "- [x] 보고서 초안"),
    ).toBe("- [x] 보고서 초안\n다음\n");
  });
});

describe("경계 케이스", () => {
  it("빈 문자열은 범위 밖으로 취급한다", () => {
    expect(lineAt("", 0)).toBeNull();
    expect(spliceLine("", 0, "X")).toBeNull();
  });

  it("개행 하나뿐인 내용의 유일한 줄을 다룬다", () => {
    expect(lineAt("\n", 0)).toBe("");
    expect(spliceLine("\n", 0, "X")).toBe("X\n");
  });

  it("줄 개수와 같은 인덱스, 음수 인덱스 모두 범위 밖이다", () => {
    expect(lineAt("a\n", 1)).toBeNull();
    expect(spliceLine("a\n", 1, "X")).toBeNull();
    expect(lineAt("a\n", -1)).toBeNull();
    expect(spliceLine("a\n", -1, "X")).toBeNull();
  });

  it("LF를 동반하지 않은 \\r은 줄 본문 안에서 그대로 남는다", () => {
    expect(lineAt("a\r\r\n", 0)).toBe("a\r");
  });

  it("한글과 이모지가 섞인 줄을 문자 단위로 안전하게 바꾼다", () => {
    expect(lineAt("회의 📅 내일\n다음\n", 0)).toBe("회의 📅 내일");
    expect(spliceLine("회의 📅 내일\n다음\n", 0, "완료 📅 오늘")).toBe(
      "완료 📅 오늘\n다음\n",
    );
  });

  it("빈 줄을 갈아끼워도 삼켜지지 않는다", () => {
    expect(spliceLine("a\n\n", 1, "X")).toBe("a\nX\n");
  });

  it("여러 줄짜리 newText를 거절한다 — 줄 번호가 어긋나면 조용한 문서 손상이 된다", () => {
    expect(() => spliceLine("a\nb\n", 0, "X\nY")).toThrow(/single line/);
  });
});

// §312 삭제 행렬 — **언어를 건너 공유된다.**
//
// 열린 문서·소스 버퍼 경로는 삭제를 Rust에 묻지 않는다(줄 문법 지식이 필요 없는 유일한
// 조작이라 preview 커맨드가 없다). 그래서 디스크 경로와의 바이트 동등성은 preview로
// 확인할 수 없고, **같은 입력에 같은 기대값**을 양쪽에 적어 두는 것으로만 성립한다.
// 짝은 `src-tauri/src/task/write.rs`의 "§312 줄 삭제" 테스트들이다 — 한쪽을 고치면
// 다른 쪽도 고칠 것. 아래 일곱 케이스가 그 행렬이고 순서까지 같다.
describe("§312 removeLine", () => {
  it("CRLF 파일의 가운데 줄을 지운다", () => {
    expect(removeLine("a\r\n- [ ] 지울 것\r\nb\r\n", 1)).toBe("a\r\nb\r\n");
  });

  it("끝 개행이 없는 파일의 마지막 줄을 지운다", () => {
    // 앞 줄의 개행은 그 줄의 것이므로 남는다. "a"가 되면 남의 종결자를 먹었다.
    expect(removeLine("a\n- [ ] 지울 것", 1)).toBe("a\n");
  });

  // 뮤테이션이 드러낸 구멍이다. 끝 개행 유무를 "지운 뒤에 다시 붙일지"로 다루면
  // (`join("\n")` 뒤 무조건 push) 여기서 **없던 개행이 생긴다** — 위 여섯 케이스는 전부
  // 통과하면서. 종결자를 조각에 붙인 채 다루면 애초에 붙일 일이 없다.
  it("끝 개행이 없는 파일의 가운데 줄을 지워도 개행이 생기지 않는다", () => {
    expect(removeLine("a\n- [ ] 지울 것\nb", 1)).toBe("a\nb");
  });

  it("첫 줄을 지운다", () => {
    expect(removeLine("- [ ] 지울 것\na\n", 0)).toBe("a\n");
  });

  it("끝 개행이 있는 파일의 마지막 줄을 지운다", () => {
    expect(removeLine("a\n- [ ] 지울 것\n", 1)).toBe("a\n");
  });

  it("유일한 줄을 지우면 빈 내용이 된다", () => {
    // "\n"이 남으면 없던 빈 줄을 하나 만든 것이다.
    expect(removeLine("- [ ] 지울 것\n", 0)).toBe("");
  });

  it("끝 개행이 없는 유일한 줄을 지우면 빈 내용이 된다", () => {
    expect(removeLine("- [ ] 지울 것", 0)).toBe("");
  });

  it("중첩 항목을 지우면서 이웃의 들여쓰기를 건드리지 않는다", () => {
    expect(removeLine("- [ ] 부모\n    - [ ] 하위\n- [ ] 다음\n", 1)).toBe(
      "- [ ] 부모\n- [ ] 다음\n",
    );
  });

  it("종결자가 섞인 파일에서 남은 줄의 EOL을 바꾸지 않는다", () => {
    // M1에서 실제 데이터 손실을 낸 형태(fd8dbe7d). 파일 전체에서 종결자 하나를 골라
    // split/join하면 여기서 남은 줄의 EOL이 고른 쪽으로 통일된다.
    expect(removeLine("- [ ] a\r\n- [ ] b\n- [ ] c\n", 1)).toBe(
      "- [ ] a\r\n- [ ] c\n",
    );
  });

  // spliceLine은 범위 밖에 `null`을 돌려주지만 삭제는 **던진다**. 호출자가 이미
  // `lineAt`으로 그 줄의 존재와 내용을 확인한 뒤에만 여기 오므로(apply-task-delete.ts),
  // 이 시점의 범위 밖은 경합이 아니라 버그다 — null로 돌려주면 "지웠다"와 구별되지
  // 않는 조용한 무작동이 된다.
  it("범위 밖 줄 번호는 던진다", () => {
    expect(() => removeLine("a\n", 5)).toThrow(/out of range/);
    expect(() => removeLine("a\n", 1)).toThrow(/out of range/);
    expect(() => removeLine("a\n", -1)).toThrow(/out of range/);
    expect(() => removeLine("", 0)).toThrow(/out of range/);
  });

  it("빈 줄도 지운다 — 내용이 비었다고 범위 밖이 아니다", () => {
    expect(removeLine("a\n\nb\n", 1)).toBe("a\nb\n");
  });
});

describe("isSameLine", () => {
  it("뒤쪽 공백을 무시한다 — Rust replace_line의 trim_end() 대응", () => {
    expect(isSameLine("- [ ] a  ", "- [ ] a")).toBe(true);
  });

  it("앞쪽 들여쓰기는 무시하지 않는다", () => {
    expect(isSameLine("  - [ ] a", "- [ ] a")).toBe(false);
  });

  it("본문이 다르면 false", () => {
    expect(isSameLine("- [ ] a", "- [ ] b")).toBe(false);
  });
});
