// §305 열린 문서의 한 줄만 갈아끼운다 — 줄바꿈 스타일과 끝 개행 유무를 보존한다.
//
// `content.split("\n").join("\n")`을 쓰면 CRLF가 파괴된다. M1에서 Rust 쪽의
// 같은 실수가 혼합 EOL 파일의 뒷부분을 실제로 날렸다(fd8dbe7d). 종결자를 조각에
// 붙인 채로 잘라 두면 재조립이 무손실이 된다.

/**
 * 낙관적 잠금 비교. Rust `replace_line`이 양변에 `.trim_end()`를 걸므로
 * 여기서도 같은 기준을 쓴다(`src-tauri/src/task/write.rs:38-40`).
 *
 * 유니코드 정규화는 필요 없다 — `TaskEntry.raw`는 원본 소스 줄이고
 * (`src-tauri/src/task/mod.rs:78`) `openFiles`의 내용도 같은 원본이라
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
