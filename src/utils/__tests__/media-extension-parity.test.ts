// §324-e 언어 간 드리프트 가드 — 프런트가 "미디어"라고 부르는 확장자 집합과
// Rust `read_media_data_url`이 열어 주는 허용목록이 같아야 한다.
//
// ‼️ 이 파일이 존재하는 이유는 두 드리프트가 **둘 다 조용하기** 때문이다:
//  - 프런트에는 있고 Rust에 없는 확장자 → 캡처 창에 끌어다 놓으면 아무 일도
//    일어나지 않는다. 예외도 토스트도 없이 그냥 안 된다.
//  - Rust에 있고 프런트에 없는 확장자 → 볼트 밖 아무 데서나 읽어 줄 수 있는
//    허용 표면인데 부르는 사람이 없다. 즉 이유 없이 넓은 권한.
//
// 스크레이프 쪽 doctrine(카운트 단정 · 소스 텍스트를 받는 함수)은
// `scripts/rust-constants.ts` 헤더에 있다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  inlineMediaByteCap,
  inlineMediaExtensions,
} from "../../../scripts/rust-constants";
import { MAX_INLINE_MEDIA_BYTES } from "../media-data-url";
import { isMediaFilePath, VIDEO_FILE_EXTENSIONS } from "../media-src";
import { IMAGE_EXTENSIONS, isImageFile } from "../path-utils";

const MEDIA_RS = join(process.cwd(), "src-tauri/src/fs/media.rs");
const rustSource = readFileSync(MEDIA_RS, "utf8");

/** 프런트의 canonical 집합 — 두 목록의 합집합. 세 번째 열거를 만들지 않는다. */
const frontendMedia = new Set([...IMAGE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS]);

describe("§324-e media extension parity (TS ↔ Rust)", () => {
  it("두 집합이 정확히 같다", () => {
    const rust = inlineMediaExtensions(rustSource);
    expect([...rust].sort()).toEqual([...frontendMedia].sort());
  });

  // 위 단정이 "둘 다 비어 있다"로 통과하지 않는다는 확인. 스크레이프가 조용히
  // 빈 집합을 내면 parity는 만족되지만 가드는 아무것도 지키지 않는다.
  it("스크레이프가 실제로 표를 읽었다", () => {
    const rust = inlineMediaExtensions(rustSource);
    expect(rust.size).toBeGreaterThanOrEqual(14);
    expect(rust).toContain("png");
    expect(rust).toContain("mp4");
  });

  // 집합이 같다는 것과 **판정 함수**가 그 집합을 따른다는 것은 다른 주장이다.
  // Rust가 여는 확장자마다 프런트의 실제 게이트(`isMediaFilePath`, OS 드랍
  // 필터가 쓰는 그 함수)가 통과시켜야 한다.
  it.each([...inlineMediaExtensions(rustSource)].sort())(
    "isMediaFilePath가 .%s를 미디어로 본다",
    (ext) => {
      expect(isMediaFilePath(`/Users/me/Desktop/shot.${ext}`)).toBe(true);
    },
  );

  // 대문자 확장자는 macOS에서 그대로 온다. Rust는 소문자로 접어 비교하므로
  // 프런트도 같아야 한다 — 갈라지면 `IMG_0001.PNG` 드랍이 한쪽에서만 통과한다.
  it("양쪽 모두 확장자를 대소문자 구분 없이 본다", () => {
    expect(isImageFile("/a/IMG_0001.PNG")).toBe(true);
    expect(isMediaFilePath("/a/CLIP.MP4")).toBe(true);
    expect(rustSource).toContain("to_ascii_lowercase");
  });

  // ‼️ 이것이 **언어 간 앵커**다. 붙여넣기 경로는 Rust를 거치지 않으므로 TS에
  // 자기 상수가 필요하고(`MAX_INLINE_MEDIA_BYTES`), 두 값이 어긋나면 같은 파일이
  // 붙여넣기로는 들어가고 드랍으로는 거절된다 — 사용자에게는 무작위로 보인다.
  // 리터럴을 여기 또 적지 않는다: 긁어 온 값과 **런타임이 쓰는 값**을 직접 비교해야
  // 한쪽만 고친 커밋이 빨간불이 된다.
  it("Rust의 상한과 TS 상수가 같은 값이다", () => {
    expect(inlineMediaByteCap(rustSource)).toBe(MAX_INLINE_MEDIA_BYTES);
  });

  // 위 단정이 "둘 다 0"으로 통과하지 않는다는 확인 — 그리고 25 MiB라는 판단
  // 자체가 조용히 바뀌지 않게 한다(바뀌려면 이 줄을 손으로 고쳐야 한다).
  it("그 값이 실제로 25 MiB다", () => {
    expect(MAX_INLINE_MEDIA_BYTES).toBe(26_214_400);
  });

  // ‼️ 스크레이프가 "매치가 하나 있다"가 아니라 "**그** 선언"을 읽는다는 확인.
  // 함수가 파일이 아니라 소스 텍스트를 받는 이유가 이것이다 — 조작한 소스를
  // 먹여 거절을 실제로 관찰할 수 있다.
  it("선언이 둘이면 추측하지 않고 거절한다", () => {
    const doubled = `${rustSource}\n${rustSource}`;
    expect(() => inlineMediaExtensions(doubled)).toThrow(/refusing to guess/);
    expect(() => inlineMediaByteCap(doubled)).toThrow(/refusing to guess/);
  });

  it("선언이 없으면 거절한다", () => {
    expect(() => inlineMediaExtensions("// nothing here")).toThrow(
      /refusing to guess/,
    );
    expect(() => inlineMediaByteCap("// nothing here")).toThrow(
      /refusing to guess/,
    );
  });
});
