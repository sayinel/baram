// §365 스펙 0057 §7 검사 5 의 스캐너. TS/TSX 소스에서 간격·모서리 값을 네 갈래로 센다.
//
// 정규식이 아니라 AST 다(`inner-html-sites.ts` · `import-boundary.ts` 와 같은 관용) —
// 주석 속 `padding: 8px` 를 세지 않고, 문자열 안과 밖을 가린다.
//
// ‼️ 경계 — 보지 **않는** 것(래칫이 못 잡는 자리):
//   - 숫자 **식**(`paddingLeft: depth * 16`) — 타입 검사기 없이 값인지 알 수 없다.
//     리터럴 숫자와 `px` 를 담은 템플릿만 센다.
//   - 축약 속성(`{ padding }`) · 스프레드 · 계산된 키.
//   - `className` 속성 **밖**의 클래스 문자열(`const cls = "p-2"` 를 나중에 넘기는 것).
//   - DOM 프로퍼티 대입(`el.style.padding = "8px"`) — 객체 리터럴의 PropertyAssignment 가
//     아니라서 스캐너가 보지 않는다.
// 삼항(`?:`)·괄호·`??`·`||` 로 감싼 리터럴은 잎까지 내려가 본다(`toPx(8)` 같은 호출의
// 인자는 값이 아니라서 내려가지 않는다). 이 경계 안에서 새 값이 생기면 래칫이 빨개진다.
// 경계 밖은 코드 리뷰의 몫이다.
import ts from "typescript";

export type Channel = "css-text" | "style-number" | "style-px" | "tailwind";

export interface Hit {
  channel: Channel;
  line: number;
  text: string;
}

/** React style 객체의 간격·모서리 키 — stylelint 관문의 속성 집합과 같은 가족. */
const STYLE_KEY =
  /^(?:(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?|gap|rowGap|columnGap|border(?:TopLeft|TopRight|BottomLeft|BottomRight|StartStart|StartEnd|EndStart|EndEnd)?Radius)$/u;

/** 0 이 아닌 px — stylelint 관문과 같은 정규식(`stylelint.config.mjs`). */
const NONZERO_PX = /\b\d*[1-9]\d*px\b/u;

/** 문자열 안의 CSS 선언 — 관문과 같은 속성 가족, 0 이 아닌 px. */
const CSS_DECLARATION =
  /(?:^|[\s;{"'`])(?:padding|margin|gap|row-gap|column-gap|border(?:-[a-z]+)*-radius)(?:-[a-z]+)*\s*:\s*[^;{}]*?\b\d*[1-9]\d*px\b/gu;

/** Tailwind 간격·rounded 유틸 — 변형 접두(`last:`·`hover:`)를 벗긴 뒤 판정. */
const TAILWIND =
  /^-?(?:(?:p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y)-(?:\d+(?:\.\d+)?|px|\[[^\]]+\])|rounded(?:-[a-z0-9]+)*(?:-\[[^\]]+\])?)$/u;

export function scanSource(fileName: string, source: string): Hit[] {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: Hit[] = [];
  const hit = (node: ts.Node, channel: Channel): void => {
    hits.push({
      channel,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      text: node.getText(sf),
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      STYLE_KEY.test(propertyName(node.name))
    ) {
      const leaves = collectLeaves(node.initializer);
      if (leaves.some(leafIsPx)) {
        hit(node, "style-px");
      } else if (leaves.some(leafIsNonzeroNumber)) {
        hit(node, "style-number");
      }
      return;
    }
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "className" &&
      node.initializer !== undefined
    ) {
      for (const text of stringTexts(node.initializer)) {
        for (const token of text.split(/\s+/u)) {
          if (TAILWIND.test(stripVariants(token))) hit(node, "tailwind");
        }
      }
      return;
    }
    const texts =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? [node.text]
        : ts.isTemplateExpression(node)
          ? templateTexts(node)
          : [];
    for (const text of texts) {
      const count = [...text.matchAll(CSS_DECLARATION)].length;
      for (let i = 0; i < count; i++) hit(node, "css-text");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/**
 * STYLE_KEY 값을 잎(leaf) 리터럴까지 내려가며 모은다 — 값을 만드는 모양(삼항의 두 갈래 ·
 * 괄호 · `??`·`||` 의 양쪽)만 내려가고, 그 밖(호출 등)은 잎 자신으로 멈춘다.
 * `toPx(8)` 의 `8` 은 인자지 padding 값이 아니라서 내려가지 않는다.
 */
function collectLeaves(node: ts.Expression): ts.Expression[] {
  if (ts.isConditionalExpression(node)) {
    return [...collectLeaves(node.whenTrue), ...collectLeaves(node.whenFalse)];
  }
  if (ts.isParenthesizedExpression(node)) {
    return collectLeaves(node.expression);
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...collectLeaves(node.left), ...collectLeaves(node.right)];
  }
  return [node];
}

/** 잎 하나가 0 이 아닌 px 문자열/템플릿인가. */
function leafIsPx(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return NONZERO_PX.test(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    return templateTexts(node).some((t) => t.includes("px"));
  }
  return false;
}

/** 잎 하나가 0 이 아닌 숫자 리터럴(음수 포함)인가. */
function leafIsNonzeroNumber(node: ts.Expression): boolean {
  const amount = numericValue(node);
  return amount !== undefined && amount !== 0;
}

function numericValue(node: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : "";
}

/** `className` 값 안의 모든 문자열 조각 — 리터럴, 템플릿, 삼항 안의 리터럴까지. */
function stringTexts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [
      ...templateTexts(node),
      ...node.templateSpans.flatMap((span) => stringTexts(span.expression)),
    ];
  }
  const out: string[] = [];
  ts.forEachChild(node, (child) => {
    out.push(...stringTexts(child));
  });
  return out;
}

function stripVariants(token: string): string {
  // `last:mb-0` → `mb-0`. 대괄호 안의 `:` 는 변형이 아니다(`p-[calc(1px+2px)]`).
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut);
}

function templateTexts(node: ts.TemplateExpression): string[] {
  return [
    node.head.text,
    ...node.templateSpans.map((span) => span.literal.text),
  ];
}
