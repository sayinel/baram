// §321 캡처 항목을 노트의 `## Captures` 절에 붙이는 순수 문자열 처리.
//
// ‼️ 이 파일의 리터럴은 **디스크에 쓰이는 문자열**이므로 번역하지 않는다. 절 이름이
// 로케일에 의존하면 앱 언어를 바꾼 사용자가 append 대상 절을 못 찾고, 같은 문서에
// 절이 두 개 생긴다.

/** append 대상 절의 헤딩. 로케일 독립(§324 구현 규약). */
export const CAPTURES_HEADING = "## Captures";

/**
 * 절 헤딩을 찾는 패턴 — `###`(항목 헤딩)은 잡지 않는다.
 *
 * ‼️ 공백은 `[ \t]`로 좁힌다. `\s`는 개행도 포함하므로 `\s*$`가 헤딩 뒤 개행까지
 * 매치에 삼켜서(그리디 백트래킹이 다음 줄 시작 직전에서 멈춘다) `appendCapture`의
 * `cut` 계산이 한 글자 어긋나고, 두 번째 append부터 절 헤딩 뒤에 빈 줄이 하나 더
 * 생긴다(라운드트립에서 remark가 그 여분을 지워 형태가 갈린다).
 */
const CAPTURES_HEADING_RE = /^##[ \t]+Captures[ \t]*$/m;

export interface CaptureEntry {
  /** 마크다운 본문. 미디어 추출을 이미 거친 문자열이다. */
  body: string;
  /** `### ` 뒤에 올 텍스트. 신규 `YYYY-MM-DD HH:MM`, 마이그레이션 `YYYY-MM-DD`(§321). */
  heading: string;
  /** `Source:` 줄의 원문. 비어 있으면 줄을 만들지 않는다. */
  source?: string;
}

/** http/https만. 닫힌 집합이다 — 다른 스킴은 평문으로 남는다. */
const HTTP_URL_RE = /^https?:\/\/\S+$/;

/**
 * §324-f `Source:` 줄. 값의 **마지막 토큰이 URL이면** 그 앞의 나머지를 제목으로 삼아
 * 링크를 만든다. 실제 데이터가 "제목 URL" 한 칸으로 적혀 있기 때문이다.
 *
 * 제목이 없으면 URL 자체가 표시 텍스트다 — 벌거벗은 `https://…`는 마크다운에서
 * 링크가 아닐 수 있는데(autolink 지원 여부에 달렸다) `[url](url)`은 언제나 링크다.
 *
 * ‼️ 번역하지 않는다. 이 줄은 노트 파일에 쓰이고 화면 문구가 아니다.
 */
export function formatSourceLine(raw: string): null | string {
  const s = raw.trim();
  if (!s) return null;

  const tokens = s.split(/\s+/);
  const last = tokens[tokens.length - 1];
  if (!HTTP_URL_RE.test(last)) return `Source: ${s}`;

  const title = tokens.slice(0, -1).join(" ");
  return `Source: ${mdLink(title || last, last)}`;
}

/** `[text](dest)` — text의 대괄호를 escape하고, 괄호를 품은 dest는 `<>`로 감싼다. */
function mdLink(text: string, dest: string): string {
  const safeText = text.replace(/([[\]])/g, "\\$1");
  const safeDest = /[()\s]/.test(dest) ? `<${dest}>` : dest;
  return `[${safeText}](${safeDest})`;
}

/** 캡처가 만든 블록 ID의 철자 — `m` + `YYMMDDHHmm`(+ 충돌 시 접미사). */
const CAPTURE_BLOCK_ID_RE = /\^(m\d{10}[\w-]*)/g;

/**
 * 캡처 항목의 블록 ID 스탬프. `m` 접두는 Zettel id(순수 숫자)와 구분하기 위한 것이고,
 * 인덱서의 형식 제약(`[a-zA-Z0-9][\w-]*` — `extractor.rs:26`의 `BLOCK_REF_RE`)을
 * 만족한다. §325 마이그레이션도 같은 철자를 쓴다 — `countCaptures`가 둘을 함께 센다.
 */
export function captureBlockIdStamp(now: Date): string {
  const y = String(now.getFullYear()).slice(2);
  return (
    `m${y}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

/** 항목 헤딩의 텍스트 — `### ` 뒤에 온다. 로케일 독립. */
export function captureHeadingText(now: Date): string {
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`
  );
}

/**
 * `## Captures` 절 안의 캡처 항목 수. 항목 하나가 헤딩 하나이므로 `###` 개수와 같아야
 * 하지만, 사용자가 손으로 헤딩을 넣었을 수 있으므로 **캡처가 실제로 남긴 표시**
 * (`^m…` 블록 ID)를 센다(§324-c).
 */
export function countCaptures(content: string): number {
  const section = capturesSection(content);
  if (section === null) return 0;
  return section.match(CAPTURE_BLOCK_ID_RE)?.length ?? 0;
}

/**
 * 이 문서 안에서 유일한 블록 ID.
 *
 * ‼️ `generateZettelId`를 쓰지 않는다. 그 함수는 **파일명**에서 모은 집합
 * (`collectExistingIds`)만 보고, append 경로는 파일을 만들지 않으므로 방금 붙인
 * 캡처의 id가 그 집합에 영원히 들어가지 않는다. 같은 분에 두 번 캡처하면 같은 id가
 * 나오고, 문서 안에서 중복된 블록 ID는 참조의 대상을 정하지 못하게 만든다(§321).
 *
 * 대상 문서를 읽는 것은 append를 위해 어차피 하는 일이므로 추가 비용이 없다.
 * 충돌 시 초를 붙이고(2자리), 그것도 충돌하면 계속 늘린다 — `generateZettelId`와
 * 같은 방식이다.
 *
 * ‼️ `capturesSection`으로 절 안에만 좁히지 않는다 — 유일성은 **문서 전체**의
 * 속성이다. 절 밖의 우연한 `^m…`(예: 무관한 절의 블록 참조)을 "사용 중"으로
 * 오판해도 다음 후보를 더 보수적으로 고를 뿐 충돌을 만들지 않는다. 반대로 절 안에만
 * 좁혔다가 절 밖의 실제 사용을 놓치면 §321이 막으려는 바로 그 충돌이 생긴다.
 */
export function nextCaptureBlockId(content: string, stamp: string): string {
  const used = new Set<string>();
  for (const m of content.matchAll(CAPTURE_BLOCK_ID_RE)) used.add(m[1]);
  if (!used.has(stamp)) return stamp;
  for (let s = 0; s < 100; s++) {
    const candidate = `${stamp}${pad(s)}`;
    if (!used.has(candidate)) return candidate;
  }
  let extra = 0;
  let candidate = `${stamp}99-${extra}`;
  while (used.has(candidate)) candidate = `${stamp}99-${++extra}`;
  return candidate;
}

/**
 * `## Captures` 헤딩 **뒤부터 다음 h1/h2 헤딩 전까지**의 텍스트. 절이 없으면 `null`.
 *
 * ‼️ `#{1,2}`로 다음 절 경계를 잡는다 — `###`(항목 헤딩)에서 멈추면 안 된다. 안 하면
 * 뒤따르는 `## Related` 같은 무관한 절 안의 우연한 `^m…` 블록 참조(예:
 * `((otherNote#^m1234567890))`)까지 `countCaptures`가 캡처로 잘못 센다. 캡처 id
 * 철자가 `m` + 10자리라 실수로 다른 참조와 겹치기 쉽다.
 *
 * "절 헤딩을 찾아 다음 절 헤딩 전까지 자른다"는 접근 자체는
 * `journal-memories.ts:37-44`, `:94-108`이 같은 이유로 이미 쓰고 있다. 다만 그
 * 코드의 패턴(`/^## /m`)보다 **의도적으로 넓게** 잡는다 — 두 가지가 그 패턴을
 * 새지 못한다: (1) `## Captures` 뒤에 `#` 헤딩(h1)이 와도 그 h2 절은 끝난다,
 * `/^## /m`은 h1을 지나치고 계속 센다. (2) CommonMark는 `#` 뒤에 탭도 허용하는데
 * (`##\tRelated`) 리터럴 스페이스만 보는 패턴은 그 줄을 놓친다.
 */
function capturesSection(content: string): null | string {
  const m = CAPTURES_HEADING_RE.exec(content);
  if (!m) return null;
  const rest = content.slice(m.index + m[0].length);
  const next = rest.match(/^#{1,2}[ \t]/m);
  return next ? rest.slice(0, next.index) : rest;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 항목 하나를 `## Captures` 절 **맨 위**에 넣은 새 문서를 돌려준다(§321).
 *
 * 삽입은 **마크다운 문자열 수준**에서 한다. PM 트랜잭션으로 노드를 꽂지 않는 이유는
 * 쓰기 경로 세 갈래 중 둘(`source`·`disk`)이 애초에 PM 문서가 아니기 때문이다 —
 * 한 가지 방식이면 절을 찾는 코드도 하나면 된다(§322 구현 메모).
 *
 * ‼️ 블록 ID는 **헤딩 끝**에 붙는다. `appendBlockId`가 그렇게 쓰고
 * (`pipeline/block-id.ts:14`) `pm-to-md`가 그렇게 재직렬화하므로
 * (`pm-to-md.ts:149`), 자기 줄에 두면 라운드트립에서 형태가 바뀐다. 헤딩에 붙이면
 * 참조가 항목 전체를 가리키고 사용자의 문단을 건드리지 않는다.
 */
export function appendCapture(
  content: string,
  entry: CaptureEntry,
  blockId: string,
): string {
  const lines = [`### ${entry.heading} ^${blockId}`, "", entry.body.trim()];
  const source = formatSourceLine(entry.source ?? "");
  if (source) lines.push("", source);
  const block = lines.join("\n");

  const heading = CAPTURES_HEADING_RE.exec(content);
  if (!heading) {
    // 절이 없으면 문서 끝에 만든다 — 기존 내용을 건드리지 않는 유일한 안전한 자리.
    // ‼️ `content`가 빈 문자열이면(§325 마이그레이션이 빈 문서에서 시작할 수 있다)
    // `trimEnd()`도 빈 문자열이라, 무조건 앞에 구분자를 붙이면 문서가 빈 줄로
    // 시작한다 — 라운드트립에서 remark가 그 선행 개행을 지워 형태가 갈린다.
    const head = content.trimEnd();
    const prefix = head ? `${head}\n\n` : "";
    return `${prefix}${CAPTURES_HEADING}\n\n${block}\n`;
  }

  const cut = heading.index + heading[0].length;
  const rest = content.slice(cut).replace(/^\n+/, "");
  const tail = rest ? `\n\n${rest}` : "\n";
  return `${content.slice(0, cut)}\n\n${block}${tail}`;
}
