import type { TabSwitchContext } from "./types";
// §298 split-review §2 — original use-tab-switching.ts:391-408.
import type { Editor } from "@tiptap/core";

import { dispatchSetSearchTerm } from "../../extensions/plugins/find-replace";
import { useUIStore } from "../../stores/ui/ui";
import {
  scrollToTarget,
  takePendingScroll,
} from "../../utils/editor/pending-scroll";

// §perf-large-file B1: Post-load handler (scroll + search highlight)
// [MAJOR-7] Parameterized by `loadEditor` so keep-alive loads target the
// correct editor instance (not the shared one).
//
// §313 ‼️ 호출 순서: 문서가 **설치된 뒤에** 불러야 한다. 이 콜백은 pending scroll을
// `content`(들어오는 문서 텍스트) 기준으로 좌표를 계산하므로, 아직 나가는 문서가 화면에
// 남아 있는 동안 부르면 남의 문서의 줄 번호로 커서를 옮기게 된다. 캐시 복원
// (`restore-cached-state.ts`)과 cold load(`load-tab-content.ts`)의 `finishLoad` 모두
// 문서 설치 이후 이 함수를 부르는 규칙을 지킨다.
export function afterDocLoad(
  ctx: TabSwitchContext,
  loadEditor: Editor,
  filePath: string,
  content: string,
): void {
  // §29/§313 백링크·검색·아젠다가 건 스크롤 요청 — 이 파일 앞으로 온 것만
  // 소비하고, 다른 파일을 향한 요청은 여기서 버린다(`takePendingScroll`).
  const target = takePendingScroll(filePath);
  if (target) scrollToTarget(loadEditor.view, content, target);

  // §5.11 Handle pending search highlight after document load
  const pendingHighlight = useUIStore.getState().pendingSearchHighlight;
  if (pendingHighlight) {
    useUIStore.getState().setPendingSearchHighlight(null);
    setTimeout(() => {
      if (!loadEditor?.view) return;
      dispatchSetSearchTerm(loadEditor.view, pendingHighlight);
      ctx.setFindReplaceOpen(true);
      ctx.setFindReplaceMode("find");
    }, 50);
  }
}
