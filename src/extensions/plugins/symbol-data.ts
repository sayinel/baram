// §376 Text symbols for the `:` autocomplete, curated by hand.
//
// Emoji datasets do not carry them: emojibase has ➡️ but no → (ko/compact.json,
// 2026-09-23). The list is data, not i18n — the Korean names live here, out of
// the catalogs' sorting and parity tests (spec 0056 §376).
//
// Rendering (plan 0099, fontTools against PretendardVariable.woff2): all but
// ≡ ∈ ∀ ∃ ∧ ∨ ∩ ∪ ⊂ are in the editor's bundled face; those nine fall back to
// the next family in `--font-family-editor`.

/**
 * The table's `#` headings, in order — each names the category of the rows
 * under it, and the symbol picker (§377) shows one section per category.
 */
export const SYMBOL_CATEGORIES = [
  "arrows",
  "math",
  "currency",
  "punctuation",
  "marks",
  "other",
] as const;

export type SymbolCategory = (typeof SYMBOL_CATEGORIES)[number];

export interface SymbolEntry {
  readonly char: string;
  readonly en: string;
  /** Lowercase search terms, English and Korean together. */
  readonly keywords: readonly string[];
  readonly ko: string;
  /** GitHub shortcodes (`heart`, `+1`), lowercase. Emoji only — symbols have none. */
  readonly shortcodes?: readonly string[];
}

/** A curated symbol: every row of `TABLE` is under a heading. */
export interface CuratedSymbol extends SymbolEntry {
  readonly category: SymbolCategory;
}

/** Heading text in `TABLE` → category. A heading not listed here throws. */
const HEADINGS: Readonly<Partial<Record<string, SymbolCategory>>> = {
  Arrows: "arrows",
  Currency: "currency",
  "Marks and shapes": "marks",
  Math: "math",
  Other: "other",
  Punctuation: "punctuation",
};

/**
 * One symbol per line: `char | English label | Korean label | keywords`,
 * keywords separated by spaces. `#` lines are headings (`HEADINGS`). A table
 * rather than object literals so formatting keeps one symbol on one line.
 */
const TABLE = `
# Arrows
→ | right arrow | 오른쪽 화살표 | arrow right to 화살표 오른쪽
← | left arrow | 왼쪽 화살표 | arrow left from 화살표 왼쪽
↑ | up arrow | 위쪽 화살표 | arrow up 화살표 위
↓ | down arrow | 아래쪽 화살표 | arrow down 화살표 아래
↔ | left right arrow | 양쪽 화살표 | arrow both 화살표 양쪽
⇒ | rightwards double arrow | 오른쪽 이중 화살표 | arrow implies then 화살표 이중 그러므로
⇐ | leftwards double arrow | 왼쪽 이중 화살표 | arrow 화살표 이중
⇔ | left right double arrow | 양쪽 이중 화살표 | arrow iff equivalent 화살표 동치 필요충분
# Math
≤ | less-than or equal to | 작거나 같음 | le lte leq 이하
≥ | greater-than or equal to | 크거나 같음 | ge gte geq 이상
≠ | not equal to | 같지 않음 | ne neq not 다름
± | plus-minus | 플러스마이너스 | pm plus minus
× | multiplication | 곱하기 | times multiply x 곱셈
÷ | division | 나누기 | divide 나눗셈
∞ | infinity | 무한대 | inf 무한
≈ | almost equal to | 근삿값 | approx about 약 근사
≡ | identical to | 항등 | equiv identical 합동
√ | square root | 제곱근 | sqrt root 루트
∑ | summation | 합 | sum sigma 시그마
∏ | product | 곱 | prod
Δ | delta | 델타 | change 변화량
π | pi | 파이 | 원주율
° | degree | 도 | deg 온도 각도
μ | micro | 마이크로 | mu 뮤
‰ | per mille | 퍼밀 | permille 천분율
∈ | element of | 원소 | in element 속함
∀ | for all | 모든 | forall all 임의
∃ | there exists | 존재 | exists some
∧ | logical and | 논리곱 | and wedge 그리고
∨ | logical or | 논리합 | or vee 또는
¬ | not sign | 부정 | not neg
∩ | intersection | 교집합 | cap intersect
∪ | union | 합집합 | cup
⊂ | subset of | 부분집합 | subset
# Currency
€ | euro | 유로 | eur currency 통화
£ | pound | 파운드 | gbp currency 통화
¥ | yen | 엔 | jpy yuan cny 위안 currency 통화
₩ | won | 원 | krw currency 통화 원화
₿ | bitcoin | 비트코인 | btc currency 통화
¢ | cent | 센트 | currency 통화
# Punctuation
— | em dash | 엠 대시 | dash mdash 줄표 대시
– | en dash | 엔 대시 | dash ndash range 붙임표 대시
… | ellipsis | 말줄임표 | dots 줄임표
« | left double angle quotation mark | 왼쪽 겹꺾쇠 인용부호 | quote guillemet laquo 인용
» | right double angle quotation mark | 오른쪽 겹꺾쇠 인용부호 | quote guillemet raquo 인용
‹ | left single angle quotation mark | 왼쪽 홑꺾쇠 인용부호 | quote guillemet 인용
› | right single angle quotation mark | 오른쪽 홑꺾쇠 인용부호 | quote guillemet 인용
· | middle dot | 가운뎃점 | dot middot interpunct 가운데점
• | bullet | 글머리 기호 | dot 점
¶ | pilcrow | 단락 기호 | paragraph para 문단
§ | section sign | 절 기호 | section sect 섹션
† | dagger | 칼표 | footnote 각주
‡ | double dagger | 이중 칼표 | dagger footnote 각주
※ | reference mark | 참고표 | note reference 참고 당구장
「 | left corner bracket | 왼쪽 낫표 | bracket quote 낫표
」 | right corner bracket | 오른쪽 낫표 | bracket quote 낫표
『 | left white corner bracket | 왼쪽 겹낫표 | bracket quote 겹낫표
』 | right white corner bracket | 오른쪽 겹낫표 | bracket quote 겹낫표
〈 | left angle bracket | 왼쪽 홑화살괄호 | bracket angle 화살괄호
〉 | right angle bracket | 오른쪽 홑화살괄호 | bracket angle 화살괄호
《 | left double angle bracket | 왼쪽 겹화살괄호 | bracket angle 화살괄호 책
》 | right double angle bracket | 오른쪽 겹화살괄호 | bracket angle 화살괄호 책
# Marks and shapes
✓ | check mark | 체크 표시 | check tick done 확인 체크
✗ | ballot x | 가위표 | cross x no 엑스
★ | black star | 검은 별 | star 별
☆ | white star | 흰 별 | star 별
○ | white circle | 흰 원 | circle 동그라미 원
● | black circle | 검은 원 | circle dot 동그라미 원
△ | white up-pointing triangle | 흰 삼각형 | triangle 세모
□ | white square | 흰 사각형 | square 네모
■ | black square | 검은 사각형 | square 네모
# Other
© | copyright | 저작권 | copy c
® | registered | 등록 상표 | reg r
™ | trade mark | 상표 | tm trademark
℃ | degree celsius | 섭씨 | celsius temperature 온도
½ | one half | 2분의 1 | half 절반
¼ | one quarter | 4분의 1 | quarter
¾ | three quarters | 4분의 3 | quarters
№ | numero | 번호 | no number
`;

function parse(table: string): CuratedSymbol[] {
  const rows: CuratedSymbol[] = [];
  let category: SymbolCategory | undefined;
  for (const raw of table.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      const heading = line.slice(1).trim();
      category = HEADINGS[heading];
      if (!category)
        throw new Error(`symbol-data: unknown heading "${heading}"`);
      continue;
    }
    if (!category)
      throw new Error(`symbol-data: row before any heading "${line}"`);
    const fields = line.split(" | ");
    if (fields.length !== 4) throw new Error(`symbol-data: bad row "${line}"`);
    const [char, en, ko, keywords] = fields;
    rows.push({ category, char, en, keywords: keywords.split(" "), ko });
  }
  return rows;
}

export const SYMBOLS: readonly CuratedSymbol[] = parse(TABLE);
