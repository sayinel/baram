// §56d/§329.2 언어 간 드리프트 가드 — Rust 썸네일러의 권한 거절 코드와 TS 가 알아보는 리터럴이
// 같아야 한다.
//
// ‼️ 드리프트가 조용하다: 코드가 어긋나면 권한 거절이 다른 실패처럼 세션 캐시에 남고, 그 폴더를 연
// 뒤에도 이미지가 원본을 그린다. 타입 오류도, 양쪽에 같은 리터럴을 박은 시험도 그걸 못 본다.
//
// ‼️ 리터럴 경로 스캔이다 — 상수를 다른 파일로 옮기면 컴파일은 통과해도 이 검증이 조용히 죽는다.
// 옮길 때 아래 경로도 같이 옮길 것.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { thumbnailErrorCodes } from "../../../scripts/rust-constants";
import { isThumbnailNotAuthorizedError } from "../thumbnail-errors";

const THUMBNAIL_CMD_RS = join(
  process.cwd(),
  "src-tauri/src/commands/thumbnail_cmd.rs",
);
const codes = thumbnailErrorCodes(readFileSync(THUMBNAIL_CMD_RS, "utf8"));

describe("§56d thumbnail refusal code (TS ↔ Rust)", () => {
  // 상수를 export 해서 비교하지 않는다 — 판정 **함수**를 통과시키는 것이 더 강한 주장이다.
  it("Rust 의 거절 코드를 isThumbnailNotAuthorizedError 가 알아본다", () => {
    expect(isThumbnailNotAuthorizedError(codes.notAuthorized)).toBe(true);
  });

  // 위 하나만으로는 판정이 **아무 문자열이나** 참으로 만드는 경우를 못 가른다. 디코드 실패 문구는
  // 실제로 이 판정에 들어오는 값이다.
  it("다른 실패는 알아보지 않는다", () => {
    expect(
      isThumbnailNotAuthorizedError("썸네일을 만들 수 없는 이미지입니다"),
    ).toBe(false);
    expect(
      isThumbnailNotAuthorizedError(
        "Access denied: path is outside all registered contexts",
      ),
    ).toBe(false);
    expect(isThumbnailNotAuthorizedError(new Error(codes.notAuthorized))).toBe(
      false,
    );
  });

  // 스크레이프가 조용히 빈 문자열을 내면 위 단정들이 무의미해진다.
  it("스크레이프가 실제로 상수를 읽었다", () => {
    expect(codes.notAuthorized).toBe("THUMBNAIL_NOT_AUTHORIZED");
  });

  // 카운트 단정이 살아 있다는 확인 — 선언이 둘이면 어느 쪽이 배포되는지 알 수 없다.
  it("선언이 하나가 아니면 추측하지 않고 거절한다", () => {
    const twoDeclarations = `
      pub const THUMBNAIL_NOT_AUTHORIZED: &str = "A";
      pub const THUMBNAIL_NOT_AUTHORIZED: &str = "B";
    `;
    expect(() => thumbnailErrorCodes(twoDeclarations)).toThrow(
      /2 declarations of THUMBNAIL_NOT_AUTHORIZED/,
    );
    expect(() => thumbnailErrorCodes("")).toThrow(
      /0 declarations of THUMBNAIL_NOT_AUTHORIZED/,
    );
  });
});
