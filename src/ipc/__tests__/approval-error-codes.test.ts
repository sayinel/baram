// §333/T8 언어 간 드리프트 가드 — Rust가 돌려주는 두 에러 코드와 TS가 알아보는 두
// 리터럴이 같아야 한다.
//
// ‼️ 이 파일이 존재하는 이유는 두 드리프트가 **둘 다 조용하기** 때문이다:
//  - 거부 코드가 어긋나면 사용자의 "거부"가 알 수 없는 오류로 도착한다.
//    `use-app-startup`은 그걸 stale로 분류해 영속된 컨텍스트를 **지우고**,
//    `switchContext`는 트리를 그대로 읽는다. 타입 오류는 하나도 안 난다.
//  - 해석 실패 코드가 거부 코드와 같아지면, 삭제된 vault가 뜬 적도 없는
//    다이얼로그에 대해 "허용되지 않았습니다"를 띄운다 (§335 리뷰 I3).
//
// ‼️ 리터럴 경로 스캔이다 — 상수를 다른 파일로 옮기면 컴파일은 통과해도 이 검증이
// 조용히 죽는다. 옮길 때 아래 경로도 같이 옮길 것.
//
// 스크레이프 쪽 doctrine(카운트 단정 · 소스 텍스트를 받는 함수)은
// `scripts/rust-constants.ts` 헤더에 있다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { approvalErrorCodes } from "../../../scripts/rust-constants";
import { isApprovalDeniedError, isPathUnresolvableError } from "../approval";

const APPROVAL_CMD_RS = join(
  process.cwd(),
  "src-tauri/src/commands/approval_cmd.rs",
);
const codes = approvalErrorCodes(readFileSync(APPROVAL_CMD_RS, "utf8"));

describe("§333 approval error codes (TS ↔ Rust)", () => {
  // ‼️ 상수를 export해서 비교하지 않는 이유: 판정 **함수**를 통과시키는 것이 더
  // 강한 주장이다. 리터럴이 맞아도 가드가 그 리터럴을 안 쓰면 소용이 없다.
  it("Rust의 거부 코드를 isApprovalDeniedError가 알아본다", () => {
    expect(isApprovalDeniedError(codes.denied)).toBe(true);
  });

  it("Rust의 해석 실패 코드를 isPathUnresolvableError가 알아본다", () => {
    expect(isPathUnresolvableError(codes.unresolvable)).toBe(true);
  });

  // 위 둘만으로는 두 가드가 **아무 문자열이나** true로 만드는 경우를 못 가른다.
  it("두 가드는 서로의 코드를 알아보지 않는다", () => {
    expect(isApprovalDeniedError(codes.unresolvable)).toBe(false);
    expect(isPathUnresolvableError(codes.denied)).toBe(false);
    expect(isApprovalDeniedError("disk on fire")).toBe(false);
    expect(isPathUnresolvableError("disk on fire")).toBe(false);
  });

  // 스크레이프가 조용히 빈 문자열을 내면 위 단정들이 무의미해진다.
  it("스크레이프가 실제로 두 상수를 읽었다", () => {
    expect(codes.denied).toBe("VAULT_APPROVAL_DENIED");
    expect(codes.unresolvable).toBe("VAULT_PATH_UNRESOLVABLE");
    expect(codes.denied).not.toBe(codes.unresolvable);
  });

  // 카운트 단정이 살아 있다는 확인 — 선언이 둘이면 어느 쪽이 배포되는지 알 수 없다.
  it("선언이 하나가 아니면 추측하지 않고 거절한다", () => {
    const twoDeclarations = `
      pub const APPROVAL_DENIED: &str = "A";
      pub const APPROVAL_DENIED: &str = "B";
      pub const PATH_UNRESOLVABLE: &str = "C";
    `;
    expect(() => approvalErrorCodes(twoDeclarations)).toThrow(
      /found 2 declarations of APPROVAL_DENIED/u,
    );
    expect(() =>
      approvalErrorCodes(`pub const APPROVAL_DENIED: &str = "A";`),
    ).toThrow(/found 0 declarations of PATH_UNRESOLVABLE/u);
  });
});
