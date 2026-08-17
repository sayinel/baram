// §278.1 인라인 마크다운 링크 `[label](target)`의 타깃을 실제 파일에 맞춘다.
//
// §278은 위키링크만 다뤘다. `[[Paper.pdf]]`는 PDF를 열지만 `[label](Paper.pdf)`는
// 스킴이 없다는 이유로 `openUrl()`에 넘어갔고, OS는 상대 경로를 프로세스 CWD 기준으로
// 풀기 때문에 아무 일도 일어나지 않거나 엉뚱한 파일이 열렸다.
//
// ‼️ §278과 같은 이유로 **확장자를 열거하지 않는다.** 열거하면 §69가 뷰어 타입을
// 더할 때마다 이 목록을 함께 갱신해야 하고, 잊으면 그 타입만 조용히 빠진다.
// 대신 "파일 트리에 이 경로의 파일이 실제로 있는가"만 묻는다 — 있으면 앱에서 열고,
// 없으면 호출부가 예전처럼 `openUrl()`로 넘긴다. 그래서 `[x](www.example.com)`처럼
// 스킴 없는 외부 주소도 그대로 동작한다: 그런 이름의 파일은 트리에 없다.
//
// ‼️ 이 함수는 해석을 **추가만** 한다. 지금 앱에서 열리는 링크(`.md`/`.markdown`)는
// 호출부가 별도로 계속 붙잡으므로, 여기서 못 찾았다고 기존 링크가 외부로 새지 않는다.
import { normalizePath } from "../path-utils";

/** 트리에서 조회할 때 필요한 최소 형태 — `FlatFile`이 이것을 만족한다. */
export interface LocalLinkFile {
  path: string;
}

/** 인라인 링크가 마크다운 문서를 가리키는가 — 확장자만 본다. */
export function isMarkdownHref(filePart: string): boolean {
  return /\.(?:md|markdown)$/i.test(filePart);
}

/**
 * 인라인 링크의 경로 부분(`#fragment` 제외)을 열 수 있는 절대 경로로 바꾼다.
 * 트리에 없으면 `null` — 호출부가 외부 URL로 처리하도록.
 *
 * @param filePart  링크의 경로 부분. 상대 경로이거나 `/`로 시작하는 절대 경로.
 * @param sourceDir 링크가 들어 있는 문서의 디렉터리. 없으면 상대 경로는 못 푼다.
 * @param files     현재 컨텍스트의 평탄화된 파일 목록.
 */
export function resolveLocalLinkTarget(
  filePart: string,
  sourceDir: null | string,
  files: LocalLinkFile[],
): null | string {
  const candidates = localLinkCandidates(filePart, sourceDir);
  if (candidates.length === 0 || files.length === 0) return null;

  for (const candidate of candidates) {
    if (files.some((f) => f.path === candidate)) return candidate;
  }
  // 대소문자 무시는 정확 일치가 전부 실패한 뒤에만. macOS/Windows의 기본
  // 파일시스템은 대소문자를 구분하지 않으므로 사용자가 링크에 적은 대소문자가
  // 파일명과 다를 수 있다. 순서를 지켜야 대소문자만 다른 두 파일이 공존하는
  // 대소문자 구분 파일시스템에서 정확한 쪽이 이긴다.
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const hit = files.find((f) => f.path.toLowerCase() === lower);
    if (hit) return hit.path;
  }
  return null;
}

function decodePercent(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    // `50% off.md`처럼 퍼센트가 이스케이프가 아닌 이름은 URIError를 던진다.
    // 원본이 이미 후보에 있으므로 조용히 포기하는 것이 맞다.
    return value;
  }
}

/**
 * 시도해 볼 절대 경로들. 가장 그럴듯한 것부터.
 *
 * ‼️ 퍼센트 디코딩한 후보를 함께 낸다. 우리 직렬화기는 공백이 든 이름을
 * `[label](<My Paper.pdf>)`로 쓰지만(꺾쇠), Obsidian을 비롯한 다른 편집기와
 * 붙여넣은 링크는 `My%20Paper.pdf`로 온다 — remark는 그 퍼센트 인코딩을 풀지 않고
 * `link.url`에 그대로 담는다(직접 확인함). 디코딩만 하고 원본을 버리면 이름에
 * 진짜 `%`가 든 파일(`50% off.md`)을 잃으므로 **둘 다** 후보다.
 */
function localLinkCandidates(
  filePart: string,
  sourceDir: null | string,
): string[] {
  const forms = [filePart];
  const decoded = decodePercent(filePart);
  if (decoded !== filePart) forms.push(decoded);

  const candidates: string[] = [];
  for (const form of forms) {
    if (!form) continue;
    // `/`로 시작하면 OS 절대 경로로 읽는다. 예전 코드는 이것도 현재 디렉터리에
    // 이어 붙여 `/vault/dir//abs/path`를 만들었다 — 어떤 파일도 가리키지 못한다.
    if (form.startsWith("/")) candidates.push(normalizePath(form));
    else if (sourceDir) candidates.push(normalizePath(`${sourceDir}/${form}`));
  }
  return candidates;
}
