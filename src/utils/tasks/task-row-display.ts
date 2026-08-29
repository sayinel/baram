// §306 태스크 행에 **보이는** 글자 — 원문이 아니라 표시용이다.

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * 본문의 `[[target]]` / `[[target|alias]]`를 표시 텍스트로 바꾼다.
 *
 * alias가 있으면 사용자가 직접 붙인 그 표시를 우선한다 — `titleFor(target)`으로 덮어쓰면
 * 그 별칭을 조용히 버리게 된다. 별칭을 적는 행위 자체가 "여기서는 이렇게 부르겠다"는
 * 뜻이므로, 인덱스가 아는 제목보다 그쪽이 권위 있다.
 */
export function displayText(
  text: string,
  titleFor: (target: string) => string,
): string {
  return text.replace(WIKILINK_RE, (_, inner: string) => {
    const [target, alias] = inner.split("|");
    return alias?.trim() || titleFor(target.trim());
  });
}
