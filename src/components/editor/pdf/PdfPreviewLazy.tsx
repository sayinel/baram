// §286 PdfPreview의 지연 로딩 래퍼.
//
// 자체 파일인 이유는 react-refresh 규칙이다: 컴포넌트를 정의하는 파일은 컴포넌트만
// export해야 한다. tab-surface-renderers.tsx는 팩토리 함수를 export하므로 `lazy()`가
// 거기 있으면 그 파일이 "컴포넌트 + 비컴포넌트 혼합"이 된다.
import { lazy } from "react";

export const PdfPreviewLazy = lazy(() =>
  import("./PdfPreview").then((m) => ({ default: m.PdfPreview })),
);
