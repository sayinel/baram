// §312 두 문자열 사이의 **최소 교체 구간**.
//
// ‼️ 왜 전체 교체(0..length)가 아닌가: CodeMirror는 트랜잭션의 change를 통해 선택 영역을
// 옮긴다. 문서를 통째로 갈아끼우면 캐럿이 갈 자리가 없어 구간의 끝(또는 시작)으로
// 떨어지고, 커서를 그리려는 뷰가 스크롤까지 따라 움직인다. 태스크 한 줄을 고치는 쓰기가
// 사용자의 캐럿을 문서 끝으로 던지면 그건 고친 게 아니다.
//
// 공통 접두·접미를 잘라 내면 실제로 바뀐 구간만 남고, 그 밖의 위치는 CM이 길이 차만큼
// 옮겨 준다 — 캐럿은 같은 글자 위에 남는다.

export interface TextReplaceRange {
  from: number;
  insert: string;
  to: number;
}

/**
 * `current`를 `next`로 만드는 최소 교체 구간. 두 문자열이 같으면 `null`.
 *
 * 오프셋은 CodeMirror와 같은 UTF-16 코드 유닛이다.
 */
export function textReplaceRange(
  current: string,
  next: string,
): null | TextReplaceRange {
  if (current === next) return null;

  const max = Math.min(current.length, next.length);

  let prefix = 0;
  while (
    prefix < max &&
    current.charCodeAt(prefix) === next.charCodeAt(prefix)
  ) {
    prefix++;
  }
  // 접두가 상위 서로게이트 **뒤**에서 멈췄다면 쌍 한가운데다 — 한 칸 물린다.
  if (prefix > 0 && isHighSurrogate(current.charCodeAt(prefix - 1))) prefix--;

  let suffix = 0;
  while (
    suffix < max - prefix &&
    current.charCodeAt(current.length - 1 - suffix) ===
      next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  // 접미가 하위 서로게이트 **앞**에서 멈췄다면 역시 쌍 한가운데다.
  if (
    suffix > 0 &&
    isLowSurrogate(current.charCodeAt(current.length - suffix))
  ) {
    suffix--;
  }

  return {
    from: prefix,
    insert: next.slice(prefix, next.length - suffix),
    to: current.length - suffix,
  };
}

/** 서로게이트 쌍 한가운데를 자르지 않도록 경계를 물린다. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
