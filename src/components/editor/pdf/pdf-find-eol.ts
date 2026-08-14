// §272.6 findController의 매치 오프셋이 사는 도메인 — **합성 "\n"은 없다.**
//
// ‼️ 이 파일은 원래 "EOL 오프셋 보정"을 했다. 그 전제가 틀렸고, 그 보정이
// 실제 버그였다. 측정으로 확인한 것(2페이지 합성 PDF, 1페이지의 item 2개,
// 첫 item만 hasEOL=true, "alpha"를 검색):
//
//   items                     ["Baram find probe alpha"(hasEOL), "second line beta alpha"]
//   controller _pageContents  "Baram find probe alpha second line beta alpha"  (45자)
//   controller pageMatches    [17, 39]
//
//   합성 "\n"을 넣은 도메인("...alpha\nsecond...")에서 39 → " alph"   ✗ 한 칸 앞
//   item.str만 이어붙인 도메인("...alphasecond...")에서 39 → "alpha"  ✓
//
// 왜 그런가: PDFFindController는 확실히 "\n"이 들어간 문자열로 검색하지만,
// 매치를 배열에 넣기 전에 #calculateMatch가 getOriginalIndex(diffs, …)로
// 인덱스를 되돌린다. pdfjs 자신의 TextHighlighter._convertMatches
// (pdf_viewer.mjs:10926)가 그 오프셋을 **textContentItemsStr** — 합성 항목이
// 전혀 없는 순수 item.str 배열 — 에 그대로 walk시키는 것이 그 증거다.
//
// 증상: 첫 매치는 정확하고, 그 이후 매치가 **앞선 EOL 개수만큼 왼쪽으로**
// 밀렸다. 실사용자가 정확히 그렇게 보고했고, 진짜 pdfjs로 도는 통합
// 테스트(use-pdf-find-integration.test.ts)가 같은 어긋남을 독립적으로 잡았다.
//
// 그래서 변환은 보정 없이 convertMatches(pdf-find.ts)를 item.str 배열에 그대로
// 호출한다 — pdfjs와 같은 도메인, 같은 산술. 이 파일에 남은 것은 pdfjs의
// item 유니온을 좁히는 일뿐이다.

/** convertMatches에 넘길 텍스트 항목. hasEOL은 더 이상 오프셋에 영향을 주지
 * 않지만(위 헤더 참조), pdfjs item의 형태를 그대로 반영해 둔다. */
export interface EolTextItem {
  hasEOL?: boolean;
  str: string;
}

/** findController 도메인의 오프셋을 그대로 walk할 텍스트 배열. */
export function toDomainStrings(items: readonly EolTextItem[]): string[] {
  return items.map((i) => i.str);
}

/**
 * page.getTextContent().items를 EolTextItem[]으로 좁힌다. includeMarkedContent
 * 를 안 쓰므로 이론상 전부 TextItem이어야 하지만, str이 없는 항목
 * (TextMarkedContent)은 방어적으로 건너뛴다. 파라미터를 unknown[]로 받는
 * 이유: pdfjs의 `TextItem | TextMarkedContent` 유니온을 곧바로
 * `{ hasEOL?; str? }` 같은 "전부 optional" 타입에 대입하면 TS가 두 타입에
 * 겹치는 프로퍼티가 하나도 없다고 보고 weak-type 오류를 낸다
 * (TextMarkedContent는 str/hasEOL이 전혀 없다) — 직접 unknown으로 받아
 * 런타임에 좁힌다.
 *
 * ‼️ 건너뛰기는 오프셋에 안전하다: findController도 같은 항목들을 같은 순서로
 * 보고, str이 없는 항목은 어느 쪽 도메인에도 문자를 기여하지 않는다.
 */
export function toEolItems(items: readonly unknown[]): EolTextItem[] {
  const result: EolTextItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) {
      continue;
    }
    const str = (item as { str: unknown }).str;
    if (typeof str !== "string") continue;
    const hasEOL = "hasEOL" in item ? Boolean(item.hasEOL) : false;
    result.push({ hasEOL, str });
  }
  return result;
}
