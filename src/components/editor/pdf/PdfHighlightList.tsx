// §282.2 레일의 하이라이트 목록. §277.2부터 **아카이브의 집**이기도 하다.
//
// ‼️ 클릭 이동에는 새 코드가 없다. usePdfHighlightFlash가 이미
// `useLinkStore.pendingPdfHighlightId`를 지켜보다가 그 id를 이 PDF의 사이드카에서
// 찾아 페이지로 스크롤하고 잠깐 강조한다(§275.6 — 노트의 블록 참조를 클릭했을 때
// 쓰는 그 경로다). 목록 항목의 onClick은 그 스토어 값을 세우기만 하면 된다.
// 두 번째 점프 경로를 만들면 "어느 쪽이 진짜인가"가 생기고, 스크롤 대상 등록
// (pageElsRef)이 한 곳뿐이라는 §272의 전제도 흐려진다.
//
// §277.2 왜 소프트 삭제가 이 목록 없이는 성립하지 않는가: 삭제된 하이라이트는
// 페이지에서 사라지지만 사이드카에는 남는다. 그것을 다시 볼 수단이 없으면
// 사용자는 되돌릴 수도, 정말로 지울 수도 없고 사이드카는 아무도 못 보는 채로
// 무한히 자란다. 그래서 목록이 두 갈래(활성/삭제됨)를 함께 보여준다.
import { useMemo, useRef, useState } from "react";

import type { StoredHighlight } from "./pdf-highlight-sidecar";
import type { PdfPageRetention } from "./pdf-page-retention";
import type { PDFPageProxy } from "pdfjs-dist";

import { useTranslation } from "../../../i18n/useTranslation";
import { useLinkStore } from "../../../stores/editor/link";
import { sortHighlightsForList } from "./pdf-highlight-list-order";
import { isDeletedHighlight } from "./pdf-highlight-sidecar";
import { PdfHighlightListItem } from "./PdfHighlightListItem";
import { usePdfHighlightList } from "./use-pdf-highlight-list";
import { useRailRovingFocus } from "./use-rail-roving-focus";

type ListView = "active" | "deleted";

export function PdfHighlightList({
  absCompanionPath,
  flashHighlightId,
  highlights,
  onPurgeHighlight,
  onRestoreHighlight,
  pages,
  retention,
}: {
  absCompanionPath: null | string;
  /** 방금 점프한 하이라이트 — 본문과 같은 항목을 목록에서도 짚어 준다. */
  flashHighlightId: null | string;
  /** §277.2 삭제된 것까지 **전부**. 갈라 보여주는 것은 이 컴포넌트의 일이다. */
  highlights: StoredHighlight[];
  onPurgeHighlight: (id: string) => void;
  onRestoreHighlight: (id: string) => void;
  pages: PDFPageProxy[];
  /** §282.3 본문 페이지와 공유하는 렌더 캐시 레지스트리 — 그대로 항목에 넘긴다. */
  retention: PdfPageRetention;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<ListView>("active");

  const pagesByNumber = useMemo(
    () => new Map(pages.map((p) => [p.pageNumber, p])),
    [pages],
  );

  // §277.2 한 번만 훑어 두 갈래로 나눈다 — 아래 두 곳(개수 뱃지, 보여줄 목록)이
  // 각자 filter를 돌면 그 두 판정이 갈라질 수 있다.
  const { active, deleted } = useMemo(() => {
    const activeList: StoredHighlight[] = [];
    const deletedList: StoredHighlight[] = [];
    for (const h of highlights) {
      (isDeletedHighlight(h) ? deletedList : activeList).push(h);
    }
    return { active: activeList, deleted: deletedList };
  }, [highlights]);

  const shown = view === "deleted" ? deleted : active;

  // 사이드카는 생성 순서로 쌓인다 — 목록은 읽는 순서여야 한다. 정렬이
  // 뷰포트 공간에서 이뤄지므로(회전 페이지, pdf-highlight-list-order.ts 참조)
  // 페이지 프록시가 필요하다.
  const ordered = useMemo(
    () =>
      sortHighlightsForList(
        shown,
        (pageNumber) =>
          pagesByNumber.get(pageNumber)?.getViewport({ scale: 1 }) ?? null,
      ),
    [shown, pagesByNumber],
  );
  const items = usePdfHighlightList(ordered, absCompanionPath);

  // §282.4 페이지 목록과 같은 이유 — 목록 전체가 탭 정지점 하나여야 한다.
  // 기본 위치는 방금 점프한 항목(없으면 첫 줄)이다.
  const keys = useMemo(() => ordered.map((h) => h.id), [ordered]);
  const { onKeyDown, rovingKey } = useRailRovingFocus(
    keys,
    flashHighlightId,
    listRef,
    "data-pdf-highlight-id",
  );

  return (
    <div className="pdf-highlight-list-frame">
      {/* §277.2 두 갈래 전환. 삭제된 것이 0개여도 계속 보여준다 — 필요할 때만
          나타나게 하면 방금 삭제한 순간 컨트롤이 튀어나오고, 마지막 항목을
          복원하면 사라지면서 지금 보고 있던 화면이 발밑에서 없어진다. */}
      <div className="pdf-highlight-list-views" role="tablist">
        <ViewTab
          active={view === "active"}
          count={active.length}
          label={t("pdfSidePanel.highlightsActive")}
          onSelect={() => setView("active")}
          testId="pdf-highlight-view-active"
        />
        <ViewTab
          active={view === "deleted"}
          count={deleted.length}
          label={t("pdfSidePanel.highlightsDeleted")}
          onSelect={() => setView("deleted")}
          testId="pdf-highlight-view-deleted"
        />
      </div>

      {items.length === 0 ? (
        <p className="pdf-highlight-list-empty">
          {view === "deleted"
            ? t("pdfSidePanel.noDeletedHighlights")
            : t("pdfSidePanel.noHighlights")}
        </p>
      ) : (
        <div className="pdf-highlight-list" onKeyDown={onKeyDown} ref={listRef}>
          {items.map((item) => (
            <div className="pdf-highlight-row" key={item.highlight.id}>
              <PdfHighlightListItem
                isDeleted={view === "deleted"}
                isFlashing={item.highlight.id === flashHighlightId}
                item={item}
                onSelect={selectHighlight}
                page={pagesByNumber.get(item.highlight.page) ?? null}
                pageLabel={t("pdfSidePanel.pageLabel", {
                  page: String(item.highlight.page),
                })}
                retention={retention}
                tabIndex={item.highlight.id === rovingKey ? 0 : -1}
              />
              {/* ‼️ 항목 자체가 <button>이라 액션 버튼을 그 안에 넣을 수 없다
                  (버튼 중첩은 유효하지 않은 HTML이고, 실제로 중첩 버튼의 클릭이
                  바깥 버튼에도 잡힌다). 형제로 둔다. */}
              {view === "deleted" && (
                <div className="pdf-highlight-row-actions">
                  <button
                    className="btn-unstyled pdf-highlight-row-action"
                    onClick={() => onRestoreHighlight(item.highlight.id)}
                    type="button"
                  >
                    {t("pdfHighlight.restore")}
                  </button>
                  <button
                    className="btn-unstyled pdf-highlight-row-action danger"
                    onClick={() => onPurgeHighlight(item.highlight.id)}
                    type="button"
                  >
                    {t("pdfHighlight.purge")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function selectHighlight(highlightId: string): void {
  useLinkStore.getState().setPendingPdfHighlightId(highlightId);
}

function ViewTab({
  active,
  count,
  label,
  onSelect,
  testId,
}: {
  active: boolean;
  count: number;
  label: string;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      aria-selected={active}
      className={[
        "btn-unstyled",
        "pdf-highlight-list-view",
        active ? "active" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {label}
      <span className="pdf-highlight-list-view-count">{count}</span>
    </button>
  );
}
