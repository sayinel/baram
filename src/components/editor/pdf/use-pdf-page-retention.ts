// §282.3 렌더 캐시 레지스트리의 수명을 문서 수명에 묶는다.
//
// PdfPreview 안에 인라인으로 둘 수도 있었지만 그러면 이 배선을 시험할 방법이
// 없다 — PdfPreview는 모듈 최상단에서 pdfjs를 가져오고 실제 문서를 열어야
// 렌더되므로 jsdom에서 마운트되지 않는다(PdfPreview.test.ts가 순수 함수만
// 시험하는 이유). 여기가 지켜야 하는 성질은 눈에 잘 띄지 않으면서 조용히
// 새기 좋은 종류다: **문서가 바뀌면 옛 레지스트리를 버려야 한다.** 안 버리면
// 맵이 이미 파기된 프록시를 계속 붙들고, 파일을 갈아 끼울수록 쌓인다.
import { useEffect, useMemo } from "react";

import type { PDFDocumentProxy } from "pdfjs-dist";

import { PdfPageRetention } from "./pdf-page-retention";

/**
 * 이 문서에 딸린 페이지 렌더 캐시 레지스트리를 돌려준다.
 *
 * 문서가 바뀌면 새 인스턴스를 만들고 **이전 것을 정리한다**. 정리를 effect에
 * 두는 이유는 렌더 중에 부수효과를 내지 않기 위해서다 — deps가 `retention`이라
 * 새 인스턴스가 만들어지는 렌더의 커밋 시점에 옛 인스턴스의 cleanup이 돈다.
 */
export function usePdfPageRetention(
  doc: null | PDFDocumentProxy,
): PdfPageRetention {
  // `doc`은 팩토리가 **읽는** 값이 아니라 신원의 키다 — "문서가 바뀌면 새
  // 레지스트리"라는 규칙을 deps로 적은 것이고, 아래 effect가 그 교체 시점에 옛
  // 것을 정리한다. exhaustive-deps는 이 용법(prop을 키로 자원을 리셋)을 표현할
  // 수단이 없어 불필요한 의존성으로 본다.
  //
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 위 설명 참조
  const retention = useMemo(() => new PdfPageRetention(), [doc]);

  useEffect(() => () => retention.dispose(), [retention]);

  return retention;
}
