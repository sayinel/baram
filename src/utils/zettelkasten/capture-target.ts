// §320 태그가 주소다 — 캡처 태그를 Zettel `notes/` 아래의 대상 노트로 푼다.
//
// 매칭은 **제목과 별칭만** 본다. 노트의 태그는 보지 않는다 — 허브 노트는 자기 이름의
// 리프 태그를 갖는데(§325: 그 태그가 자동완성에 뜨게 하기 위해서다), 태그까지 보면
// 매칭이 자기 자신을 도는 경로가 하나 더 생겨 규칙이 두 가지 이유로 참이 된다.

import { parseNoteTitle } from "./parse-note-title";
import { parseFrontmatterAliases } from "./zettel-note";

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
 * 태그 목록이 지목하는 노트들. 매칭이 없으면 빈 배열 — 호출자가 `inbox/` 폴백으로 간다.
 *
 * 대상은 **경로로 중복 제거**한다. 같은 노트를 제목과 별칭으로 각각 지목할 수 있고
 * (`title: Links` + `aliases: [Link]`에 `#links #link`), 그대로 두면 같은 항목이 문서에
 * 두 번 들어간다. 먼저 매칭시킨 태그를 남긴다 — 어느 쪽이든 대상은 같은 노트다.
 */
export function resolveCaptureTargets(
  tags: string[],
  notes: NoteCandidate[],
): CaptureTarget[] {
  const out: CaptureTarget[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const key = normalize(rawTag);
    if (!key) continue;

    for (const note of notes) {
      if (seen.has(note.path)) continue;
      const title = parseNoteTitle(note.filename, note.content);
      const aliases = parseFrontmatterAliases(note.content);
      // `rawTag`는 태그 모양 입력이라 공백을 담지 못한다(`is_tag_char` —
      // `src-tauri/src/md/mod.rs:25`) — 공백 있는 제목과는 애초에 같아질 수 없어
      // 별칭만 비교한다. 위키링크 대상처럼 공백을 가질 수 있는 입력이 이 함수를
      // 부르게 되면 이 판단은 다시 내려야 한다.
      const names = /\s/.test(title) ? aliases : [title, ...aliases];
      if (!names.some((name) => normalize(name) === key)) continue;
      seen.add(note.path);
      out.push({ matchedTag: rawTag, path: note.path, title });
    }
  }

  return out;
}

/** 비교 정규화 — 앞뒤 공백 제거 + 소문자. `#` 접두는 호출부에서 이미 벗겨져 온다. */
function normalize(s: string): string {
  return s.trim().toLowerCase();
}
