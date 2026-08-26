// §305 열린 문서의 한 줄만 갈아끼운다 — 줄바꿈 스타일과 끝 개행 유무를 보존한다.
//
// `content.split("\n").join("\n")`을 쓰면 CRLF가 파괴된다. M1에서 Rust 쪽의
// 같은 실수가 혼합 EOL 파일의 뒷부분을 실제로 날렸다(fd8dbe7d). 종결자를 조각에
// 붙인 채로 잘라 두면 재조립이 무손실이 된다.

/**
 * 낙관적 잠금 비교. Rust `replace_line`이 양변에 `.trim_end()`를 걸므로
 * 여기서도 같은 기준을 쓴다(`src-tauri/src/task/write.rs:40`).
 *
 * 유니코드 정규화는 필요 없다 — `TaskEntry.raw`는 원본 소스 줄이고
 * (`src-tauri/src/task/mod.rs:81`) `openFiles`의 내용도 같은 원본이라
 * 양쪽 모두 정규화 전 형태끼리 비교된다.
 */
export function isSameLine(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd();
}

/** `line`(0-based) 줄의 본문. 범위를 벗어나면 `null`. */
export function lineAt(content: string, line: number): null | string {
  const parts = splitKeepingEol(content);
  const part = parts[line];
  return part === undefined ? null : stripEol(part);
}

/**
 * §312 `line`(0-based) 줄을 **없앤다** — 자기 종결자까지 함께. 손대지 않은 줄의 바이트는
 * 원본 그대로이므로 줄바꿈 스타일과 끝 개행 유무가 저절로 보존된다.
 *
 * `spliceLine`의 "한 줄 → 한 줄" 불변식을 완화하는 대신 **형제 함수**로 두는 이유:
 * 그 가드가 막으려던 것은 "모르고 줄 수를 바꾸는 것"이고 여기서 줄이 하나 사라지는 것은
 * 의도다. 두 조작을 한 함수에 합치면 그 가드가 지키는 것이 무엇인지 알 수 없게 된다.
 *
 * 범위 밖이면 **던진다** — `spliceLine`이 `null`을 돌려주는 것과 갈리는 지점이다.
 * 호출자는 이 함수를 부르기 전에 `lineAt`으로 그 줄의 존재와 내용을 이미 확인한다
 * (`apply-task-delete.ts`, 그 사이에 `await`가 없어 끼어들 틈도 없다). 그러므로 이 시점의
 * 범위 밖은 경합이 아니라 버그이고, `null`로 돌려주면 "지웠다"와 구별되지 않는 조용한
 * 무작동이 된다 — 파괴적 조작에서 가장 나쁜 실패 양식이다.
 */
export function removeLine(content: string, line: number): string {
  const parts = splitKeepingEol(content);
  if (line < 0 || line >= parts.length) {
    throw new Error(`removeLine: line ${line} is out of range`);
  }
  parts.splice(line, 1);
  return parts.join("");
}

/**
 * `line`(0-based) 줄만 `newText`로 바꾼다. 그 줄의 원래 종결자를 그대로 재사용하므로
 * 혼합 EOL 파일에서도 건드리지 않은 줄은 바뀌지 않는다. 범위를 벗어나면 `null`.
 */
export function spliceLine(
  content: string,
  line: number,
  newText: string,
): null | string {
  // 이 함수의 불변식은 "정확히 한 줄을 한 줄로 바꾼다"이다. 여러 줄을 넣으면
  // 줄 수가 늘어 호출자가 들고 있는 이후 줄 번호가 전부 어긋난다 — 조용히
  // 넘기면 M2-b의 아카이브/수집함 이동에서 문서 손상으로 나타난다.
  if (/[\r\n]/.test(newText)) {
    throw new Error(
      `spliceLine: newText must be a single line, got ${JSON.stringify(newText)}`,
    );
  }
  const parts = splitKeepingEol(content);
  const part = parts[line];
  if (part === undefined) return null;
  const eol = part.slice(stripEol(part).length);
  parts[line] = newText + eol;
  return parts.join("");
}

/** 종결자(`\n`·`\r\n`)를 각 조각의 끝에 붙인 채로 자른다. 끝 개행이 없어도 안전하다. */
function splitKeepingEol(content: string): string[] {
  const parts = content.split(/(?<=\n)/);
  // 끝이 개행이면 split이 빈 꼬리를 남긴다 — 줄 개수가 하나 늘지 않게 뗀다.
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** 조각에서 종결자를 뗀 본문. Rust의 `str::lines()`와 같이 `\r`도 뗀다. */
function stripEol(part: string): string {
  return part.replace(/\r?\n$/, "");
}
