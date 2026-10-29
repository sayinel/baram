// §312 줄 원문에 그 태그가 **쓰는 쪽 어휘로** 들어 있는가.
//
// 태그 이름을 정하는 자가 코드베이스에 둘 있다. 읽는 쪽(`src-tauri/src/md/mod.rs`의
// `INLINE_TAG_RE`)과 쓰는 쪽(같은 파일의 `is_tag_char`, `task/tag.rs`의 `find_tag`가 쓴다).
// 둘이 갈리면 UI가 할 수 없는 일을 약속한다: 라벨은 읽는 쪽에서 오고 동작은 쓰는 쪽에서
// 오므로, 라벨이 가리키는 태그를 쓰는 쪽이 못 찾으면 "해제"를 눌러도 줄이 한 바이트도
// 바뀌지 않는다. 그래서 **라벨도 쓰는 쪽 어휘로 판정한다**.
//
// 가장 흔했던 갈림(하이픈 — 읽는 쪽만 `#someday-maybe`를 `someday`로 끊었다)은 닫혔고,
// 글자 집합의 갈림도 닫혔다: Rust는 `is_tag_char`를 읽는 쪽의 문자 클래스
// (`md::TAG_PART_CLASS`)로 짓고, 아래 `TAG_CHAR_RE`는 그 클래스를 JavaScript로 옮긴 것이다.
// 남은 갈림은 `#someday/` 하나다 — 읽는 쪽은 뒤에 마디가 없는 `/` 앞에서 멈추고, 쓰는 쪽은
// `/`를 태그 글자로 본다(그 줄이 아젠다에서 "잠김"이다).
//
// 언어가 달라 한 벌로 만들 수는 없으므로 **같은 행을 양쪽이 읽는다**:
// `src-tauri/src/task/fixtures/tag-boundary.json`. `task-tag-token.test.ts`와 `tag.rs`의
// `tag_boundary_table_is_shared_with_the_front_end`가 그 파일을 읽는다 — 한쪽 어휘만 바꾸면
// 그쪽 시험이 그 행에서 빨간불이 되고, 행을 바꾸면 따르지 않은 쪽이 빨간불이 된다.
//
// ‼️ 이것은 태그를 **찾는** 규칙일 뿐 쓰기 규칙이 아니다. 무엇을 어디에 끼워 넣고 어떤
// 공백을 흡수할지는 여전히 Rust만 안다(`apply_tag`) — 그것까지 여기 옮기면 디스크 경로와
// 문서 경로가 갈린다. 그래도 규칙이 두 벌인 것은 사실이므로 뒤에 관문이 하나 더 있다:
// 쓰기 결과가 원문과 바이트가 같으면 성공이라고 말하지 않는다(`task-triage.ts`).

/**
 * 태그 이름에 쓸 수 있는 글자 — Rust `md::is_tag_char`와 같은 집합이다. 그쪽은 읽는 쪽의
 * 클래스 `[\w\p{Script=Hangul}-]`에 `/`를 더한 것이고, Rust `regex`의 `\w`는 유니코드
 * 단어 글자(`\p{Alphabetic}` · `\p{M}` · `\p{Nd}` · `\p{Pc}` · `\p{Join_Control}`)다.
 * JavaScript의 `\w`는 `u` 플래그를 붙여도 ASCII뿐이라 그 성질들을 하나씩 적는다.
 * 두 언어의 유니코드 표 판이 다른 글자에서는 갈릴 수 있다.
 */
const TAG_CHAR_RE =
  /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}\p{Script=Hangul}/-]/u;

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
