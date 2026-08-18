// §286 PluginDetailTab의 지연 로딩 래퍼. 자체 파일인 이유는 PdfPreviewLazy와 같다.
import { lazy } from "react";

export const PluginDetailTabLazy = lazy(() =>
  import("./PluginDetailTab").then((m) => ({ default: m.PluginDetailTab })),
);
