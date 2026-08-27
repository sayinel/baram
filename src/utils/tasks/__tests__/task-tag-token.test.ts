// §312 줄 원문에 태그가 **쓰는 쪽 기준으로** 있는가.
//
// 이 표는 읽는 쪽(`md::INLINE_TAG_RE`)과 쓰는 쪽(`task/tag.rs`의 `is_tag_char`)의 어휘가
// 갈리는 지점을 그대로 옮긴 것이다. 두 벌이 된 규칙이므로 여기서 고정하지 않으면 어긋난
// 것을 알 방법이 없다 — 어긋나는 순간 메뉴가 할 수 없는 일을 약속한다(MODERATE-1).
import { describe, expect, it } from "vitest";

import { lineHasTag } from "../task-tag-token";

describe("lineHasTag — 쓰는 쪽 경계", () => {
  it("공백으로 끊긴 태그를 찾는다", () => {
    expect(lineHasTag("- [ ] 여행 #someday", "someday")).toBe(true);
    expect(lineHasTag("- [ ] #someday 여행", "someday")).toBe(true);
    expect(lineHasTag("- [ ] 여행 #someday 준비", "someday")).toBe(true);
  });

  it("줄 맨 앞의 태그도 찾는다", () => {
    expect(lineHasTag("#someday", "someday")).toBe(true);
  });

  it("여는 괄호를 경계로 인정한다 — `find_tag`의 before_ok와 같다", () => {
    expect(lineHasTag("- [ ] 여행 (#someday)", "someday")).toBe(true);
  });

  // MODERATE-1의 정확한 줄. 파서가 하이픈에서 끊어 tags=["someday"]를 주던 시절,
  // 쓰는 쪽은 하이픈을 태그 글자로 쳐서 이 줄에서 `#someday`를 찾지 못했다. 파서는
  // 고쳐졌고 이 판정은 그대로다 — 여기서 참을 돌려주면 남의 태그를 잘라내게 된다.
  it("하이픈으로 이어진 더 긴 태그는 그 태그가 아니다", () => {
    expect(lineHasTag("- [ ] 여행 #someday-maybe", "someday")).toBe(false);
    expect(lineHasTag("- [ ] 여행 #someday-", "someday")).toBe(false);
  });

  // ‼️ 읽는 쪽과 쓰는 쪽이 지금도 갈리는 유일한 부류 — `½`는 Rust `is_alphanumeric()`
  // (그리고 여기 `\p{N}`)에는 들어가지만 인덱서의 `\w`에는 안 들어간다. 인덱서는 이
  // 줄을 `["someday"]`로 읽고 여기서는 다른 태그로 본다. `tag.rs`의 표에 같은 줄이 있다.
  it("숫자 기호로 이어진 것도 그 태그가 아니다", () => {
    expect(lineHasTag("- [ ] 여행 #someday½", "someday")).toBe(false);
  });

  it("슬래시·밑줄·글자로 이어진 것도 그 태그가 아니다", () => {
    expect(lineHasTag("- [ ] 여행 #someday/maybe", "someday")).toBe(false);
    expect(lineHasTag("- [ ] 여행 #someday_maybe", "someday")).toBe(false);
    expect(lineHasTag("- [ ] 여행 #somedaymaybe", "someday")).toBe(false);
    expect(lineHasTag("- [ ] 여행 #someday언젠가", "someday")).toBe(false);
    expect(lineHasTag("- [ ] 여행 #someday2", "someday")).toBe(false);
  });

  // 태그 글자가 아닌 것으로 끝나면 쓰는 쪽이 제거할 수 있다 — 여기서 거짓을 돌려주면
  // 멀쩡히 동작하는 행에서 메뉴 항목이 죽는다.
  it("문장부호로 끝나는 태그는 여전히 그 태그다", () => {
    expect(lineHasTag("- [ ] 여행 #someday.", "someday")).toBe(true);
    expect(lineHasTag("- [ ] 여행 #someday,", "someday")).toBe(true);
  });

  it("단어 안이나 URL 조각은 태그가 아니다", () => {
    expect(lineHasTag("- [ ] a#someday", "someday")).toBe(false);
    expect(lineHasTag("- [ ] https://x/#someday", "someday")).toBe(false);
  });

  // 한 줄에 둘 다 있으면 **찾을 수 있는 쪽**이 답이다 — 제거가 실제로 동작한다.
  it("긴 태그와 진짜 태그가 함께 있으면 있다고 답한다", () => {
    expect(lineHasTag("- [ ] 여행 #someday-maybe #someday", "someday")).toBe(
      true,
    );
  });

  it("아예 없으면 없다고 답한다", () => {
    expect(lineHasTag("- [ ] 여행", "someday")).toBe(false);
  });
});
