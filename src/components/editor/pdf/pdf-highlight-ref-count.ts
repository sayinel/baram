// §277.2 이 하이라이트를 가리키는 블록 참조가 문서 몇 곳에 있는가.
//
// 완전 삭제(purgeHighlightById)는 되돌릴 수 없고, 잃는 것은 하이라이트 자체가
// 아니라 **그것을 가리키던 참조들**이다 — 항목이 사라지면 resolveHighlightRef가
// null을 돌려 그 참조들이 마크다운에 구워진 80자 display로 퇴화한다
// (pdf-highlight-sidecar.ts의 deletedAt doc comment 참조). 그러니 확인 문구는
// "몇 개를 끊는지"를 말할 수 있어야 한다.
//
// ‼️ **링크 인덱스로는 셀 수 없다.** 처음엔 getBacklinks(동반 노트 경로)로
// 셌는데, 그 경로는 실앱에서 **항상 0**을 돌려준다 — 실기기 확인에서 드러났고,
// getBacklinks를 vi.mock으로 덮은 테스트가 그 사실을 초록으로 가리고 있었다:
//
//   • 참조가 만드는 target은 `highlights/Paper`다 (§275.4가 동명이인을 피하려고
//     일부러 경로로 한정한다).
//   • incoming 맵의 키는 normalize_target(target) = "highlights/paper"
//     (index/mod.rs:165).
//   • 그런데 get_backlinks는 normalize_file_path(파일경로) = **"paper"**로
//     찾는다 (file_stem만, index/mod.rs:222).
//
// 두 키는 영영 만나지 않는다. 인덱스를 고치는 것이 근본이지만 그것은 Rust
// 인덱스의 키 규칙 변경이라 별개 작업이다(backlog).
//
// 그래서 전문 검색으로 **직접** 센다. 우회가 아니라 더 정확하다:
//   • 매치마다 결과가 하나씩 나오므로(파일·줄·열), get_backlinks가 결과를
//     `(source_path, line)`으로 접는 문제(index/mod.rs:233 — 한 줄에 참조가
//     둘이면 뒤엣것이 사라진다)가 아예 없다.
//   • 인덱스가 최신인지에 기대지 않는다. 방금 저장한 노트도 즉시 잡힌다.
import { searchFiles } from "../../../ipc/search";
import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";

/**
 * @returns 이 blockId를 가리키는 블록 참조의 개수. 셀 수 없으면 **0**.
 *
 * ‼️ 0은 "참조가 없다"가 아니라 "있다고 말할 근거가 없다"이다. vault가 없을
 * 수도, 검색이 실패했을 수도 있다. 호출부는 이 값이 0일 때 **안전을 약속하는
 * 문구를 쓰면 안 된다** — use-pdf-highlight-write-actions.ts의 onPurgeHighlight가
 * 0/실패를 기본 문구("되돌릴 수 없다")로 떨어뜨리는 이유다.
 *
 * ‼️ 검색 결과는 1,000건에서 잘린다(search/mod.rs의 default_max_results). 그
 * 이상은 포화된 수가 나오지만, 경고로서의 판단(수백 곳이 끊긴다)은 달라지지
 * 않는다.
 */
export async function countHighlightRefs(blockId: string): Promise<number> {
  // 블록 id는 crypto.randomUUID의 16진수 8자다(pipeline/block-id.ts). 정규식
  // 메타문자가 들어올 수 없지만, 그 사실이 바뀌면 여기서 패턴이 깨지는 대신
  // 조용히 다른 것을 세게 되므로 형태를 확인하고 아니면 세지 않는다.
  if (!/^[a-zA-Z0-9][\w-]*$/.test(blockId)) return 0;

  const { rootPath } = useFileStore.getState();
  if (!rootPath) return 0;

  try {
    // ‼️ includeGlob을 **넘기지 않는다.** 생략이 곧 ".md만"이고
    // (search/mod.rs의 include_matches: `None => name.ends_with(".md")`),
    // 그것이 정확히 우리가 원하는 범위다.
    //
    // 처음엔 `"**/*.md"`를 넘겼는데 **아무것도 매치하지 않았다** — 그 매처는
    // `*.`으로 시작하는 패턴만 확장자로 보고 나머지는 경로 접두사로 취급하므로
    // (`rel_path.starts_with("**/*.md")`), 모든 파일이 탈락한다. 형식을 짐작해
    // 넘기지 말고 그 함수의 분기를 읽을 것.
    const [refs, embeds] = await Promise.all([
      searchFiles(rootPath, blockRefPattern(blockId), { regex: true }),
      searchFiles(rootPath, blockEmbedPattern(blockId), { regex: true }),
    ]);
    // 임베드는 참조 패턴에도 걸리므로 뺀다. 음수가 될 수는 없지만, 두 검색이
    // 같은 순간의 디스크를 본다는 보장이 없으므로 바닥을 둔다.
    return Math.max(0, refs.length - embeds.length);
  } catch (err) {
    // 던지지 않는다 — 개수를 못 세는 것이 완전 삭제를 막을 이유는 아니다.
    // 확인 대화상자는 여전히 뜨고, 문구가 참조 수를 뺀 기본형이 될 뿐이다.
    logger.warn("[pdf-highlight] failed to count refs before purge:", err);
    return 0;
  }
}

/**
 * 블록 **임베드**는 완전 삭제로 아무것도 잃지 않는다 — 임베드는 동반 노트의
 * 그 문단을 그대로 그리고, 완전 삭제는 사이드카 항목만 지우므로 문단은 남는다.
 * 하이라이트 미리보기(원문 칩·영역 크롭)를 그리는 것은 블록 **참조**뿐이다:
 * resolveHighlightRef의 유일한 소비자가 usePdfHighlightRefPreview이고, 그것을
 * 쓰는 NodeView는 block-reference-view.tsx 하나다.
 *
 * 임베드도 위 참조 패턴에 걸리므로(임베드가 참조를 품고 있다) 따로 세서 뺀다.
 * Rust regex에는 lookbehind가 없어 한 패턴으로는 제외할 수 없다.
 */
function blockEmbedPattern(blockId: string): string {
  return `\\{\\{embed \\(\\([^)#|]*?#\\^${blockId}\\)\\)\\}\\}`;
}

/**
 * ‼️ 두 정규식 모두 Rust 추출기(index/extractor.rs:25-31)의 것을 그대로 옮긴
 * 것이다 — 우리가 세는 "참조"와 인덱스·NodeView가 인정하는 "참조"가 같은
 * 문자열 집합이어야 한다. 형식을 눈대중으로 흉내 내면 두 정의가 조용히
 * 갈라진다.
 *
 * target 부분이 `[^)#|]*?`인 것도 그대로다: `((#^id))`(자기 참조)까지 포함한다.
 */
function blockRefPattern(blockId: string): string {
  return `\\(\\([^)#|]*?#\\^${blockId}(?:\\|[^)]+)?\\)\\)`;
}
