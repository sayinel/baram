// §286 GraphView의 지연 로딩 래퍼. 자체 파일인 이유는 PdfPreviewLazy와 같다 —
// 컴포넌트를 정의하는 파일은 컴포넌트만 export해야 react-refresh가 동작한다.
import { lazy } from "react";

export const GraphViewLazy = lazy(() =>
  import("./GraphView").then((m) => ({ default: m.GraphView })),
);
