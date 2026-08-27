// §312 줄 원문에 그 태그가 **쓰는 쪽 어휘로** 들어 있는가.
//
// 태그 이름을 정하는 자가 코드베이스에 둘 있다. 읽는 쪽(`src-tauri/src/md/mod.rs`의
// `INLINE_TAG_RE`)과 쓰는 쪽(같은 파일의 `is_tag_char`, `task/tag.rs`의 `find_tag`가 쓴다).
// 둘이 갈리면 UI가 할 수 없는 일을 약속한다: 라벨은 읽는 쪽에서 오고 동작은 쓰는 쪽에서
// 오므로, 라벨이 가리키는 태그를 쓰는 쪽이 못 찾으면 "해제"를 눌러도 줄이 한 바이트도
// 바뀌지 않는다. 그래서 **라벨도 쓰는 쪽 어휘로 판정한다**.
//
// 가장 흔했던 갈림(하이픈 — 읽는 쪽만 `#someday-maybe`를 `someday`로 끊었다)은 닫혔다.
// 남은 것은 유니코드 가장자리뿐이다: `\w`(Rust `regex`)는 결합 문자와 `\p{Pc}`를 포함하고
// `is_alphanumeric()`은 `\p{Nl}`·`\p{No}`를 포함한다. 드물지만 0은 아니다.
//
// 언어가 달라 한 벌로 만들 수는 없으므로 **같은 표를 양쪽에 둔다**: 아래
// `task-tag-token.test.ts`의 표와 `tag.rs`의
// `tag_boundary_table_is_shared_with_the_front_end`가 같은 줄들을 본다. 어느 쪽 어휘를
// 고쳐도 다른 쪽이 빨간불이 된다.
//
// ‼️ 이것은 태그를 **찾는** 규칙일 뿐 쓰기 규칙이 아니다. 무엇을 어디에 끼워 넣고 어떤
// 공백을 흡수할지는 여전히 Rust만 안다(`apply_tag`) — 그것까지 여기 옮기면 디스크 경로와
// 문서 경로가 갈린다. 그래도 규칙이 두 벌인 것은 사실이므로 뒤에 관문이 하나 더 있다:
// 쓰기 결과가 원문과 바이트가 같으면 성공이라고 말하지 않는다(`task-triage.ts`).

/**
 * 태그 이름에 쓸 수 있는 글자 — `tag.rs`의 `is_tag_char`와 같은 집합이다.
 * Rust의 `char::is_alphanumeric()`은 `\p{Alphabetic} ∪ \p{N}`이므로 `\p{L}`이 아니라
 * `\p{Alphabetic}`을 쓴다(한글 자모처럼 둘이 갈리는 글자가 있다).
 */
const TAG_CHAR_RE = /[\p{Alphabetic}\p{N}_/-]/u;

/**
 * `line`에 `#tag`가 **경계를 갖춰** 들어 있는가 — `find_tag`가 하나라도 찾는가와 같다.
 *
 * 앞: 줄 시작이거나 공백·여는 괄호. 단어 안이나 URL 조각(`.../#someday`)을 태그로 읽으면
 * 제거가 남의 글자를 잘라낸다.
 * 뒤: 태그 글자가 이어지면 **다른 태그**다(`#somedaymaybe` `#someday-maybe` `#someday/maybe`).
 */
export function lineHasTag(line: string, tag: string): boolean {
  const needle = `#${tag}`;
  let from = 0;
  for (;;) {
    const start = line.indexOf(needle, from);
    if (start === -1) return false;
    const end = start + needle.length;
    const before = line[start - 1];
    const after = line[end];
    const beforeOk =
      before === undefined || /\s/.test(before) || before === "(";
    const afterOk = after === undefined || !TAG_CHAR_RE.test(after);
    if (beforeOk && afterOk) return true;
    from = end;
  }
}
