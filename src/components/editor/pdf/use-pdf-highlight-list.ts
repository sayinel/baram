// §282.2 하이라이트 목록의 데이터 — 사이드카(기하·색)와 동반 노트(원문)를
// 하나로 합친다.
//
// 왜 합쳐야 하는가: StoredHighlight에는 텍스트가 없다(§273.2 — 사이드카에는
// 좌표와 색만 있다). 원문의 유일한 보관처는 동반 노트의 ` ^id` 문단이다.
// 그래서 목록을 그리려면 두 곳을 봐야 한다.
//
// ‼️ 파일은 **한 번만** 읽는다. 하이라이트마다 readCompanionTextCoalesced를
// 부르면 합류 덕에 I/O는 1회로 접히지만(pdf-companion-text-cache.ts), 그것은
// 그 함수의 호출부가 서로를 모르는 NodeView들일 때 필요한 장치다. 여기서는
// 전체 목록을 한 컴포넌트가 알고 있으므로 읽기 1회 + 문자열 추출 N회가
// 그냥 옳다 — 합류에 기대면 "왜 1회인가"가 이 파일 밖의 미묘한 성질이 된다.
import { useEffect, useMemo, useState } from "react";

import type { StoredHighlight } from "./pdf-highlight-sidecar";

import { findBlockContent } from "../../../utils/editor/block-nav";
import { logger } from "../../../utils/logger";
import { readCompanionNoteContent } from "./pdf-highlight-store";

export interface HighlightListItem {
  highlight: StoredHighlight;
  /** 동반 노트의 원문. 아직 못 읽었거나 문단이 없으면 null (영역 하이라이트가
   * 그림 위에 그어졌으면 정상적으로 빈 값이다 — 그때는 크롭이 내용을 대신한다). */
  text: null | string;
}

/**
 * 정렬된 하이라이트에 동반 노트의 원문을 붙여 돌려준다.
 *
 * 읽기 실패는 목록을 죽이지 않는다 — 텍스트 없이(=null) 그린다. 사이드카가
 * 이미 페이지·색·기하를 주므로 목록은 여전히 쓸모 있고, 실패를 이유로 빈
 * 패널을 보여주면 사용자는 하이라이트가 사라졌다고 읽는다. 진단 로그는
 * readCompanionNoteContent가 남긴다(그쪽이 이 실패의 유일한 로그다).
 */
export function usePdfHighlightList(
  highlights: StoredHighlight[],
  absCompanionPath: null | string,
): HighlightListItem[] {
  const [texts, setTexts] = useState<Map<string, string>>(EMPTY_TEXTS);

  useEffect(() => {
    if (!absCompanionPath) {
      setTexts(EMPTY_TEXTS);
      return;
    }
    let cancelled = false;
    void readCompanionNoteContent(absCompanionPath)
      .then((content) => {
        if (cancelled) return;
        if (content === null) {
          setTexts(EMPTY_TEXTS);
          return;
        }
        const next = new Map<string, string>();
        for (const h of highlights) {
          const body = findBlockContent(content, h.id);
          if (body && body.trim().length > 0) next.set(h.id, body);
        }
        setTexts(next);
      })
      .catch(() => {
        if (cancelled) return;
        // readCompanionNoteContent가 이미 원인을 로그로 남겼다 — 여기서는 목록이
        // 텍스트 없이 그려진다는 사실만 남긴다(같은 실패가 로그 두 줄이 되면
        // 원인이 둘로 보인다, §276.5의 같은 판단).
        logger.warn(
          "[pdf-highlight-list] rendering without companion text after a read failure",
        );
        setTexts(EMPTY_TEXTS);
      });
    return () => {
      cancelled = true;
    };
  }, [absCompanionPath, highlights]);

  // ‼️ 메모해야 한다. 이 배열과 그 안의 래퍼 객체가 매 렌더 새로 만들어지면
  // PdfHighlightListItem의 React.memo가 `item` 신원 변화만으로 항상 통과돼
  // 아무 효과가 없다 — 목록을 memo로 감싸는 일 자체가 무의미해진다.
  return useMemo(
    () =>
      highlights.map((highlight) => ({
        highlight,
        text: texts.get(highlight.id) ?? null,
      })),
    [highlights, texts],
  );
}

const EMPTY_TEXTS = new Map<string, string>();
