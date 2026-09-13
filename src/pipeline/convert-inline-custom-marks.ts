// convert-inline-custom-marks.ts — §5.1 커스텀 인라인 마크(`==` `~` `^`) 파싱
//
// convert-inline-text.ts에서 분리 — 이 파일 하나가 단축 구문에 대한 지식을 전부 갖는다.
// 두 층이다:
//   1. `normalizeCrossNodeCustomMarks` — 형제 노드를 가로지르는 구분자 짝을 HTML 태그
//      토큰으로 정규화한다. `convert-inline.ts`의 기존 상태 기계가 그 토큰을 읽는다.
//   2. `splitTextWithCustomInlineMarks` — 텍스트 노드 하나 안에서 닫히는 짝을 처리한다.
// 1이 먼저 돌고, 남은 것을 2가 맡는다.

import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { PhrasingContent, Text } from "mdast";

/** Custom inline mark patterns: ==highlight==, ^superscript^, ~subscript~ */
const CUSTOM_MARK_PATTERNS: {
  fastCheck: string;
  markName: string;
  re: RegExp;
}[] = [
  { markName: "highlight", re: /==((?:[^=]|=[^=])+)==/g, fastCheck: "==" },
  // Superscript ^text^: like subscript, require the opening ^ to hug the first
  // content char and the closing ^ to hug the last one, so prose containing two
  // stray carets is not treated as superscript. Content must not start/end with
  // whitespace.
  {
    markName: "superscript",
    re: /\^([^^\s](?:[^^]*[^^\s])?)\^/g,
    fastCheck: "^",
  },
  // Subscript ~text~ (single tilde). To distinguish from prose that merely
  // contains two tildes (e.g. "~2배 향상 또는 ~4배"), require the opening ~ to
  // hug the first content char and the closing ~ to hug the last one — i.e.
  // the content must neither start nor end with whitespace.
  {
    markName: "subscript",
    re: /(?<![~])~([^~\s](?:[^~]*[^~\s])?)~(?!~)/g,
    fastCheck: "~",
  },
];

/** 커스텀 마크의 단축 구문 ↔ 같은 뜻의 HTML 태그 */
const CUSTOM_MARK_SHAPES: Record<string, { delimiter: string; tag: string }> = {
  highlight: { delimiter: "==", tag: "mark" },
  subscript: { delimiter: "~", tag: "sub" },
  superscript: { delimiter: "^", tag: "sup" },
};

/** 텍스트 자식 안에서 찾은 구분자 하나 (같은 노드 안에서 이미 짝지어진 것은 제외) */
interface DelimiterToken {
  childIndex: number;
  end: number;
  start: number;
}

/**
 * §5.1 형제 노드를 가로지르는 커스텀 마크 구분자를 HTML 태그 토큰으로 정규화한다.
 *
 * 왜 필요한가: `CUSTOM_MARK_PATTERNS`는 **텍스트 노드 하나**에 거는 정규식이다.
 * mdast는 `==**b**==`를 `text("==") strong text("==")`로 쪼개 놓으므로 어느 조각에도
 * 완전한 짝이 없어 하이라이트가 아예 만들어지지 않았다. 그러면 마크가 사라지고 다음
 * 저장이 `\==**b**==`를 써서, 열고 저장만 해도 파일이 손상됐다.
 *
 * 새 상태 기계를 만들지 않는다. `<mark>`/`<sub>`/`<sup>`를 형제 노드에 걸쳐 처리하는
 * 기계가 `convert-inline.ts`에 이미 있고 잘 동작하므로(그래서 `<u>`만 멀쩡했다),
 * 여기서는 구분자를 그 기계가 읽는 `html` 토큰으로 바꿔 주기만 한다.
 *
 * **같은 텍스트 노드 안에서 닫히는 짝은 건드리지 않는다** — 기존 정규식이 처리하며
 * 그쪽 동작은 바이트 단위로 그대로다. 여기서 잡는 것은 노드 경계를 넘는 짝뿐이다.
 */
export function normalizeCrossNodeCustomMarks(
  children: PhrasingContent[],
  schema: Schema,
  spanYieldsOnlyText: SpanValidator,
): PhrasingContent[] {
  if (children.length < 2) return children;
  let current = children;
  for (const { markName } of CUSTOM_MARK_PATTERNS) {
    if (!schema.marks[markName]) continue;
    const shape = CUSTOM_MARK_SHAPES[markName];
    if (!shape) continue;
    current = normalizeOneCustomMark(current, shape, spanYieldsOnlyText);
  }
  return current;
}

/**
 * 구간을 실제로 변환했을 때 **텍스트 노드만** 나오는가.
 *
 * 예측이 아니라 실측이다. 마크는 텍스트에만 실리므로, 변환 결과에 노드가 하나라도
 * 섞이면 그 구간은 이 마크를 온전히 실을 수 없다. 타입을 열거해 맞히려던 앞선 두
 * 판이 모두 틀렸다 — 처음엔 형제로 온 이미지·수식을 빠뜨렸고, 다음엔 `strong` 안에
 * **중첩된** 위키링크를 빠뜨렸다. 열거는 다음 항목이 추가되면 또 뚫린다.
 */
export type SpanValidator = (span: PhrasingContent[]) => boolean;

/** 한 종류의 커스텀 마크에 대해, 노드 경계를 넘는 짝을 전부 태그로 바꾼다 */
function normalizeOneCustomMark(
  children: PhrasingContent[],
  shape: { delimiter: string; tag: string },
  spanYieldsOnlyText: SpanValidator,
): PhrasingContent[] {
  let current = children;
  // 한 번 바꿀 때마다 자식 수가 늘어나므로 상한을 둔다 — 바꿀 것이 없으면 즉시 끝난다.
  for (let guard = 0; guard <= children.length; guard++) {
    const tokens = collectDelimiterTokens(current, shape.delimiter);
    if (tokens.length < 2) return current;
    const pair = findCrossNodePair(
      current,
      tokens,
      shape.delimiter,
      shape.tag,
      spanYieldsOnlyText,
    );
    if (!pair) return current;
    current = rewritePairAsTags(current, pair[0], pair[1], shape.tag);
  }
  return current;
}

/**
 * 텍스트 자식들에 나타난 구분자 위치를 **전부, 순서대로** 모은다.
 *
 * 같은 노드 안에서 이미 짝지어진 것을 미리 빼면 안 된다 — 진짜 여는 쪽이 앞 노드에
 * 있으면 정규식이 엉뚱한 짝을 먼저 집어삼킨다. 실제로 `==**b**== and ==plain==`에서
 * `== and ==`가 한 짝으로 먹혀 하이라이트 두 개가 하나로 합쳐졌다. 어느 짝이 유효한지는
 * 아래 순차 스캔이 정한다.
 */
function collectDelimiterTokens(
  children: PhrasingContent[],
  delimiter: string,
): DelimiterToken[] {
  const tokens: DelimiterToken[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type !== "text") continue;
    const value = (child as Text).value;
    if (!value.includes(delimiter)) continue;
    let from = 0;
    for (;;) {
      const at = value.indexOf(delimiter, from);
      if (at === -1) break;
      const end = at + delimiter.length;
      tokens.push({ childIndex: i, end, start: at });
      from = end;
    }
  }
  return tokens;
}

/**
 * 여는 쪽과 닫는 쪽의 "붙어 있어야 한다" 규칙을 노드 경계까지 확장해 본다.
 * 텍스트 끝에서 다음 형제가 노드(strong·inlineCode 등)면 공백이 아닌 것으로 친다 —
 * `==` 뒤에 바로 `**b**`가 오는 것이 정확히 우리가 살리려는 모양이기 때문이다.
 */
function neighborChar(
  children: PhrasingContent[],
  token: DelimiterToken,
  side: "after" | "before",
): string {
  const value = (children[token.childIndex] as Text).value;
  if (side === "after") {
    if (token.end < value.length) return value[token.end];
    const next = children[token.childIndex + 1];
    if (!next) return "";
    if (next.type !== "text") return "x";
    return (next as Text).value[0] ?? "";
  }
  if (token.start > 0) return value[token.start - 1];
  const prev = children[token.childIndex - 1];
  if (!prev) return "";
  if (prev.type !== "text") return "x";
  const pv = (prev as Text).value;
  return pv[pv.length - 1] ?? "";
}

/**
 * 구분자를 **왼쪽에서 오른쪽으로 순차 짝짓기** 해서, 노드 경계를 넘는 첫 짝을 돌려준다.
 *
 * 짝짓기는 인접한 두 토큰끼리만 한다 — 여는 쪽 바로 다음 토큰이 닫는 쪽이다. 중간을
 * 건너뛰어 더 먼 것과 짝지으면 그 사이의 짝이 통째로 삼켜진다. 같은 노드 안에서 닫히는
 * 짝은 여기서 건너뛰되 **소비는 한다** — 처리는 기존 정규식 몫이지만, 소비하지 않으면
 * 다음 스캔이 그 구분자를 다시 여는 쪽으로 쓴다.
 */
function findCrossNodePair(
  children: PhrasingContent[],
  tokens: DelimiterToken[],
  delimiter: string,
  tag: string,
  spanYieldsOnlyText: SpanValidator,
): [DelimiterToken, DelimiterToken] | null {
  // `==`는 원래 공백을 허용한다(`/==((?:[^=]|=[^=])+)==/`). `^`·`~`만 hug을 요구한다.
  const needsHug = delimiter !== "==";
  let i = 0;
  while (i + 1 < tokens.length) {
    const open = tokens[i];
    if (needsHug) {
      const after = neighborChar(children, open, "after");
      if (!after || /\s/.test(after)) {
        i++;
        continue;
      }
    }
    const close = tokens[i + 1];
    if (needsHug) {
      const before = neighborChar(children, close, "before");
      if (!before || /\s/.test(before)) {
        i++;
        continue;
      }
    }
    if (close.childIndex !== open.childIndex) {
      const span = spanContent(children, open, close);
      // 같은 태그가 구간 안에 이미 있으면 건드리지 않는다. 상태 기계의 플래그는
      // 카운터가 아니라 boolean이라 안쪽 `</mark>`가 바깥 것을 꺼 버린다 —
      // `==a <mark>b</mark> c==`에서 사용자의 태그가 지워지고 ` c`가 마크를 잃었다.
      // (변환 결과는 전부 텍스트라 `spanYieldsOnlyText`로는 보이지 않는다.)
      if (!containsTag(span, tag) && spanYieldsOnlyText(span)) {
        return [open, close];
      }
      // 마크를 실을 수 없는 구간 — 구분자를 글자 그대로 두고 그 뒤부터 계속 찾는다.
      // 뜻을 못 살릴 바에는 바이트를 지킨다.
      i += 2;
      continue;
    }
    i += 2; // 같은 노드 짝 — 정규식에 맡기고 둘 다 소비한다
  }
  return null;
}

/** 구간 안에 이 태그의 여닫는 토큰이 들어 있는가 */
function containsTag(span: PhrasingContent[], tag: string): boolean {
  return span.some(
    (n) =>
      n.type === "html" &&
      [`<${tag}>`, `</${tag}>`].includes((n as { value: string }).value.trim()),
  );
}

/** 두 구분자 사이의 내용만 잘라낸다 (구분자 자체는 뺀다) */
function spanContent(
  children: PhrasingContent[],
  open: DelimiterToken,
  close: DelimiterToken,
): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const head = (children[open.childIndex] as Text).value.slice(open.end);
  if (head) out.push({ type: "text", value: head } as Text);
  for (let i = open.childIndex + 1; i < close.childIndex; i++) {
    out.push(children[i]);
  }
  const tail = (children[close.childIndex] as Text).value.slice(0, close.start);
  if (tail) out.push({ type: "text", value: tail } as Text);
  return out;
}

/** 짝을 이룬 두 구분자를 여는/닫는 html 토큰으로 바꾼 새 자식 배열을 만든다 */
function rewritePairAsTags(
  children: PhrasingContent[],
  open: DelimiterToken,
  close: DelimiterToken,
  tag: string,
): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const pushText = (value: string) => {
    if (value) out.push({ type: "text", value } as Text);
  };
  for (let i = 0; i < children.length; i++) {
    if (i !== open.childIndex && i !== close.childIndex) {
      out.push(children[i]);
      continue;
    }
    const value = (children[i] as Text).value;
    if (i === open.childIndex) {
      pushText(value.slice(0, open.start));
      out.push({ type: "html", value: `<${tag}>` } as PhrasingContent);
      pushText(value.slice(open.end));
    } else {
      pushText(value.slice(0, close.start));
      out.push({ type: "html", value: `</${tag}>` } as PhrasingContent);
      pushText(value.slice(close.end));
    }
  }
  return out;
}

/**
 * Split text at custom inline mark boundaries (==highlight==, ^super^, ~sub~).
 * Processes each mark pattern in order; returns empty array if no matches.
 */
export function splitTextWithCustomInlineMarks(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Try each pattern; first match wins
  for (const { markName, re, fastCheck } of CUSTOM_MARK_PATTERNS) {
    if (!schema.marks[markName]) continue;
    if (!text.includes(fastCheck)) continue;

    const nodes = splitTextWithSingleCustomMark(
      text,
      schema,
      parentMarks,
      markName,
      re,
    );
    if (nodes.length > 0) return nodes;
  }
  return [];
}

/** Split text on a single custom mark regex, returning PM nodes with the mark applied */
function splitTextWithSingleCustomMark(
  text: string,
  schema: Schema,
  parentMarks: Mark[],
  markName: string,
  regex: RegExp,
): PmNode[] {
  const result: PmNode[] = [];
  const re = new RegExp(regex.source, regex.flags);
  let lastIndex = 0;
  let match: null | RegExpExecArray;

  while ((match = re.exec(text)) !== null) {
    // Text before the match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index);
      // Recursively check remaining patterns on the "before" text
      const beforeNodes = splitTextWithCustomInlineMarks(
        before,
        schema,
        parentMarks,
      );
      if (beforeNodes.length > 0) {
        result.push(...beforeNodes);
      } else {
        result.push(schema.text(before, parentMarks));
      }
    }

    // The matched content with the mark applied
    const mark = schema.marks[markName]?.create();
    if (mark) {
      result.push(schema.text(match[1], [...parentMarks, mark]));
    }

    lastIndex = re.lastIndex;
  }

  if (result.length === 0) return [];

  // Text after the last match
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex);
    const afterNodes = splitTextWithCustomInlineMarks(
      after,
      schema,
      parentMarks,
    );
    if (afterNodes.length > 0) {
      result.push(...afterNodes);
    } else {
      result.push(schema.text(after, parentMarks));
    }
  }

  return result;
}
