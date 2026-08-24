// §272 PDF 내 찾기 바 — PdfPreview가 소유한 PDFFindController를 조작하는
// 순수 표시 컴포넌트. 상태(matchCount/currentIdx)는 부모가 findController의
// updatefindmatchescount/updatefindcontrolstate 이벤트로부터 끌어올린다.
import { useState } from "react";

import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";

import { useTranslation } from "../../../i18n/useTranslation";

interface PdfFindBarProps {
  /** 0-based. 매치가 없으면 -1. */
  currentIdx: number;
  matchCount: number;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  onQueryChange: (query: string, caseSensitive: boolean) => void;
}

export function PdfFindBar({
  currentIdx,
  matchCount,
  onClose,
  onNext,
  onPrev,
  onQueryChange,
}: PdfFindBarProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onQueryChange(value, caseSensitive);
  };

  const handleToggleCaseSensitive = () => {
    const next = !caseSensitive;
    setCaseSensitive(next);
    onQueryChange(query, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  };

  return (
    <div
      aria-label={t("pdfFind.placeholder")}
      className="pdf-find-bar"
      role="search"
    >
      <input
        autoFocus
        className="pdf-find-input"
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("pdfFind.placeholder")}
        type="search"
        value={query}
      />

      <button
        aria-label={t("pdfFind.matchCase")}
        aria-pressed={caseSensitive}
        className={`btn-unstyled icon-btn pdf-find-toggle ${caseSensitive ? "active" : ""}`}
        onClick={handleToggleCaseSensitive}
        title={t("pdfFind.matchCase")}
        type="button"
      >
        <CaseSensitive size={16} />
      </button>

      <span className="pdf-find-count">
        {Math.max(currentIdx + 1, 0)} / {matchCount}
      </span>

      <button
        aria-label={t("pdfFind.previous")}
        className="btn-unstyled icon-btn pdf-find-nav-btn"
        disabled={matchCount === 0}
        onClick={onPrev}
        title={t("pdfFind.previous")}
        type="button"
      >
        <ChevronUp size={16} />
      </button>
      <button
        aria-label={t("pdfFind.next")}
        className="btn-unstyled icon-btn pdf-find-nav-btn"
        disabled={matchCount === 0}
        onClick={onNext}
        title={t("pdfFind.next")}
        type="button"
      >
        <ChevronDown size={16} />
      </button>

      <button
        aria-label={t("pdfFind.close")}
        className="btn-unstyled icon-btn pdf-find-close-btn"
        onClick={onClose}
        title={t("pdfFind.close")}
        type="button"
      >
        <X size={16} />
      </button>
    </div>
  );
}
