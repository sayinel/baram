// §312 줄 원문에 그 태그가 **쓰는 쪽 어휘로** 들어 있는가.
//
// 읽는 쪽과 쓰는 쪽의 태그 어휘가 다르다. 인덱서(`src-tauri/src/md/mod.rs`의
// `INLINE_TAG_RE`)는 하이픈에서 끊어 `#someday-maybe`를 `someday`로 읽고, 쓰는 쪽
// (`src-tauri/src/task/tag.rs`의 `is_tag_char`/`find_tag`)은 하이픈을 태그 글자로 쳐서
// 그 줄에서 `#someday`를 **찾지 못한다**. 인덱서 쪽이 알려진 P2 결함이고
// (dev/backlog.md, 태그 패널·태그 인덱스와 공유된 규칙이라 이 슬라이스 밖이다), 쓰는 쪽의
// 넓은 경계는 남의 태그를 잘라 놓지 않으려는 **의도된** 선택이다.
//
// 그 차이가 UI로 새면 메뉴가 할 수 없는 일을 약속한다: 라벨은 읽는 쪽에서 오고 동작은
// 쓰는 쪽에서 오므로, `#someday-maybe`가 붙은 행은 "해제"를 눌러도 줄이 한 바이트도 바뀌지
// 않는다. 그래서 **라벨도 쓰는 쪽 어휘로 판정한다**.
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
