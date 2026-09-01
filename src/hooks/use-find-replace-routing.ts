// §5.6/§272/§276.1 Find/Replace + PDF-find state, and the single router that
// decides which one a given "open find" call means.
import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { PdfFindApi } from "../components/editor/pdf/use-pdf-find";

interface UseFindReplaceRoutingReturn {
  findReplaceMode: "find" | "replace";
  findReplaceOpen: boolean;
  handleTogglePdfFind: () => void;
  pdfFindApi: null | PdfFindApi;
  pdfFindOpen: boolean;
  routeFindReplaceOpen: Dispatch<SetStateAction<boolean>>;
  setFindReplaceMode: Dispatch<SetStateAction<"find" | "replace">>;
  setFindReplaceOpen: Dispatch<SetStateAction<boolean>>;
  setPdfFindApi: Dispatch<SetStateAction<null | PdfFindApi>>;
  setPdfFindOpen: Dispatch<SetStateAction<boolean>>;
}

export function useFindReplaceRouting(
  isPdfTab: boolean,
): UseFindReplaceRoutingReturn {
  // §5.6 Find/Replace state
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceMode, setFindReplaceMode] = useState<"find" | "replace">(
    "find",
  );
  // §272 PDF 찾기 상태 — PdfPreview가 소유한 usePdfFind의 live API를 여기로
  // 끌어올려 PdfFindBar를 PdfPreview 바깥(FindReplaceBar와 같은 자리)에서
  // 그린다.
  const [pdfFindOpen, setPdfFindOpen] = useState(false);
  const [pdfFindApi, setPdfFindApi] = useState<null | PdfFindApi>(null);
  // Cmd+F/네이티브 메뉴가 부르는 setFindReplaceOpen을 여기 한 곳에서만
  // PDF 탭이면 PDF 찾기로, 아니면 원래 마크다운 찾기로 분기한다 — 키바인딩,
  // 네이티브 메뉴, 탭 전환 복원까지 4개 호출부가 각자 분기하면 어긋나기
  // 쉽다(§272 Task 5 corrections). value는 boolean이거나 함수형 업데이터일
  // 수 있다(네이티브 메뉴 edit_find_replace가 함수형을 쓴다) — 두 setState
  // setter 모두 SetStateAction을 그대로 받으므로 그대로 위임한다.
  const routeFindReplaceOpen = useCallback<
    React.Dispatch<React.SetStateAction<boolean>>
  >(
    (value) => {
      if (isPdfTab) {
        setPdfFindOpen(value);
        return;
      }
      setFindReplaceOpen(value);
    },
    // §286 setState 세터는 항상 안정 참조라 재생성 빈도에 영향을 주지 않지만, React
    // Compiler가 이 함수 아래쪽에 `surfaceKind`(§286 표면 판정, `isHtmlSourceView`를
    // 읽는다)가 생기면서 추론한 의존성이 `isPdfTab` 단독과 달라져 수동 메모이제이션을
    // 보존하지 못한다고 보고했다 — 추론한 세터를 그대로 적어 둘 일치시킨다.
    // (Tier-2 #12 추출 이후: `surfaceKind`는 이제 이 파일에 없다 — App.tsx에 남아 있어
    // 위 전제 자체는 깨졌지만, 세터는 안정 참조라 나열해 둬도 비용이 없다 — 조용히
    // 지우지 않고 그대로 둔다.)
    [isPdfTab, setFindReplaceOpen, setPdfFindOpen],
  );
  // §276.1 PdfToolbar의 찾기 토글 — 같은 pdfFindOpen을 뒤집는다. 인라인
  // 화살표를 그대로 prop으로 넘기면 PdfPreview(memo)가 매 렌더 다시 그려진다.
  const handleTogglePdfFind = useCallback(() => {
    setPdfFindOpen((v) => !v);
  }, [setPdfFindOpen]);

  return {
    findReplaceMode,
    findReplaceOpen,
    handleTogglePdfFind,
    pdfFindApi,
    pdfFindOpen,
    routeFindReplaceOpen,
    setFindReplaceMode,
    setFindReplaceOpen,
    setPdfFindApi,
    setPdfFindOpen,
  };
}
