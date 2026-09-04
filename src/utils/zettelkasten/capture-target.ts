// §320 태그가 주소다 — 캡처 태그를 Zettel `notes/` 아래의 대상 노트로 푼다.
//
// 매칭은 **제목과 별칭만** 본다. 노트의 태그는 보지 않는다 — 허브 노트는 자기 이름의
// 리프 태그를 갖는데(§325: 그 태그가 자동완성에 뜨게 하기 위해서다), 태그까지 보면
// 매칭이 자기 자신을 도는 경로가 하나 더 생겨 규칙이 두 가지 이유로 참이 된다.

import { parseNoteTitle } from "./parse-note-title";
import { parseFrontmatterAliases } from "./zettel-note";

export interface CaptureMatches {
  targets: CaptureTarget[];
  /**
   * 어떤 노트도 지목하지 못한 태그들, 입력 그대로. §324-a가 이것을 보여 준다: 태그
   * 하나가 맞으면 나머지 오타가 성공에 묻혀 조용히 사라지기 때문이다.
   *
   * ‼️ 이 태그들은 **파일에 남지 않는다 — 의도된 동작이다**(§321 포맷 질문, 설계
   * §19.11 「결정 2026-09-04: 현행 유지」). §99의 옛 inbox 경로는 태그를 fleeting note의
   * frontmatter `tags:`에 보존했으므로 이것은 **동작 변경**이지 빠뜨린 것이 아니다.
   * 근거는 §325 마이그레이션의 실측이다 — 148항목에 허브 태그 외 주제 태그가 0건이었고,
   * 즉 이 워크플로에서 태그는 *주소*로 쓰이지 *분류*로 쓰이지 않는다. 경고가 반복해서
   * 뜨기 시작하면 그때 항목 본문 끝의 인라인 태그 줄로 §321 포맷을 다시 연다.
   */
  unmatchedTags: string[];
}

export interface CaptureTarget {
  /** 이 노트를 지목한 태그 — 미리보기·토스트가 이유를 말하는 데 쓴다. 입력 그대로다. */
  matchedTag: string;
  path: string;
  /** 사람이 읽는 이름. `parseNoteTitle`의 결과 그대로다. */
  title: string;
}

export interface NoteCandidate {
  content: string;
  filename: string;
  path: string;
}

/**
 * 태그 목록이 지목하는 노트들과, **아무것도 지목하지 못한 태그들**.
 *
 * 대상은 **경로로 중복 제거**한다. 같은 노트를 제목과 별칭으로 각각 지목할 수 있고
 * (`title: Links` + `aliases: [Link]`에 `#links #link`), 그대로 두면 같은 항목이 문서에
 * 두 번 들어간다. 먼저 매칭시킨 태그를 남긴다 — 어느 쪽이든 대상은 같은 노트다.
 *
 * ‼️ 그래서 `unmatchedTags`는 `tags − targets.map(t => t.matchedTag)`가 **아니다.**
 * 중복 제거로 밀려난 `#link`는 대상 목록에 이름을 남기지 못하지만 분명히 노트를 맞혔다;
 * 그 차집합은 그것을 "아무것도 못 맞힌 태그"로 신고한다. 경고가 한 번이라도 거짓이면
 * 사용자는 다음 경고도 읽지 않으므로, 매칭 여부는 중복 제거 **전에** 기록한다.
 */
export function resolveCaptureMatches(
  tags: string[],
  notes: NoteCandidate[],
): CaptureMatches {
  const targets: CaptureTarget[] = [];
  const unmatchedTags: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const key = normalize(rawTag);
    if (!key) continue;

    let matchedSomething = false;
    for (const note of notes) {
      const title = parseNoteTitle(note.filename, note.content);
      const aliases = parseFrontmatterAliases(note.content);
      // `rawTag`는 태그 모양 입력이라 공백을 담지 못한다(`is_tag_char` —
      // `src-tauri/src/md/mod.rs:25`) — 공백 있는 제목과는 애초에 같아질 수 없어
      // 별칭만 비교한다. 위키링크 대상처럼 공백을 가질 수 있는 입력이 이 함수를
      // 부르게 되면 이 판단은 다시 내려야 한다.
      const names = /\s/.test(title) ? aliases : [title, ...aliases];
      if (!names.some((name) => normalize(name) === key)) continue;
      // ‼️ 매칭 기록이 중복 제거보다 **먼저**다 — 위 주석의 이유.
      matchedSomething = true;
      if (seen.has(note.path)) continue;
      seen.add(note.path);
      targets.push({ matchedTag: rawTag, path: note.path, title });
    }
    if (!matchedSomething) unmatchedTags.push(rawTag);
  }

  return { targets, unmatchedTags };
}

/** 비교 정규화 — 앞뒤 공백 제거 + 소문자. `#` 접두는 호출부에서 이미 벗겨져 온다. */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}
