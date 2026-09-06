import {
  serializeWikilink,
  WIKILINK_RE,
} from "../../pipeline/transformers/wikilink-transformer";
// §95 Zettelkasten export — resolve bare [[id]] wikilinks to [[id|title]] for
// EXPORT markdown only (HTML/Notion/Pandoc). The in-app .md round-trip save
// (pm-to-md.ts → serializeWikilink) MUST keep [[id]] unchanged — do not call
// this helper from that path.
import { titleForId } from "../../stores/zettelkasten/zettel-index";
import { isZettelId } from "../zettelkasten/parse-note-title";

// §perf-large-file: Pre-compiled regex with its own 'g' flag/lastIndex state,
// independent of the shared WIKILINK_RE instance (see convert-inline-text.ts).
const WIKILINK_RE_G = new RegExp(WIKILINK_RE.source, "g");

/**
 * Rewrites bare Zettelkasten-id wikilinks (`[[id]]`) to `[[id|title]]` using
 * the live zettel index, for export markdown assembly only.
 *
 * Gated identically to the in-app WikilinkView NodeView (§95): only rewrites
 * when there is no vault alias, no heading, and no existing display text —
 * i.e. a genuinely bare `[[id]]`. Cross-vault links, heading-anchored links,
 * already-aliased links (`[[id|display]]`), non-id targets, and ids with no
 * matching index entry are all left unchanged.
 */
export function resolveZettelLinksForExport(markdown: string): string {
  return markdown.replace(
    WIKILINK_RE_G,
    (
      full,
      vaultAlias: string | undefined,
      target: string,
      heading: string | undefined,
      blockId: string | undefined,
      display: string | undefined,
    ) => {
      if (vaultAlias || heading || display) return full;
      if (!isZettelId(target)) return full;

      const title = titleForId(target);
      if (!title) return full;
      // ‼️ `WIKILINK_RE`의 display 캡처는 `(?:\|([^\]]+))?` — `]`를 담지 못한다.
      // 이스케이프 없이 넣으면 내보낸 마크다운을 **다시 파싱할 수 없다**: `- [ ] 장보기`는
      // 링크를 통째로 리터럴로 만들고, `[[다른 노트]] 참고`는 조각으로 잘려 꼬리를 남긴다.
      // §99로 이 자리에 들어오는 값이 "사용자가 프론트매터에 적은 제목"에서 "임의의
      // 퀵캡처 본문 첫 줄"로 넓어졌고, 캡처 첫 줄에 `- [ ]`·`[텍스트](url)`·`[[링크]]`는 흔하다.
      // 재작성을 포기하면 출력은 `[[id]]` 그대로 — 읽기엔 덜 좋아도 손상되지 않는다.
      // 재작성은 편의이고, 파싱 가능성은 계약이다.
      if (title.includes("]")) return full;

      return serializeWikilink({
        target,
        blockId: blockId || null,
        display: title,
      });
    },
  );
}
