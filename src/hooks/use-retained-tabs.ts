// §285 유지 목록 — 편집 영역이 마운트를 유지할 탭과 그 표면 종류.
//
// 명령형 풀이 아니라 "렌더할 목록"인 이유(설계 §16.2 결정 3): 여기 실리는 표면은 전부 React
// 컴포넌트라, 목록에서 빠지면 React가 언마운트하며 각자의 cleanup(PDF의 task.destroy() 등)이
// 돈다. 기존 KeepalivePool이 수동 destroy를 갖는 것은 Tiptap Editor가 React 바깥 인스턴스이기
// 때문이고 여기엔 해당하지 않는다.
import { useMemo } from "react";

import type { EditorTab } from "../stores/editor/editor";

import { isFileTab, isPluginTab } from "../stores/editor/editor";
import {
  isBinaryViewerFile,
  isHtmlFile,
  isMarkdownFile,
  isPdfFile,
} from "../utils/file-type";

export interface RetainedEntry {
  kind: RetainedKind;
  tabId: string;
}

export type RetainedKind = "code" | "html" | "pdf" | "plugin";

export interface RetentionInput {
  /** §5.1 HTML(및 플러그인 프리뷰 파일)을 원본으로 보고 있는 탭 — App의 htmlSourceTabs. */
  htmlSourceTabs: ReadonlySet<string>;
  /**
   * 플러그인 `viewer` 확장점이 그리고 있는 탭(SVG 등).
   *
   * ‼️ 이 입력이 없으면 SVG처럼 **텍스트인데 플러그인이 그리는** 파일이 아래 마지막 줄에서
   * `code`로 떨어져, 플러그인 프리뷰와 코드 표면이 동시에 유지된다. 뷰어 레지스트리를 아는
   * 것은 App뿐이므로 판정 결과를 여기로 넘겨받는다(§290에서 플러그인 뷰어는 유지 대상 밖).
   */
  pluginPreviewTabs: ReadonlySet<string>;
  /** §5.1 마크다운을 원본으로 보고 있는 탭 — use-source-mode의 sourceModeTabs. */
  sourceModeTabs: ReadonlySet<string>;
}

/**
 * ‼️ `graph`는 여기 없다. 유지해 봤지만 cytoscape가 0×0 컨테이너에서 자기 카메라를 흔들거나
 * 초기값으로 되돌려, 세 번의 수정에도 실앱에서 계속 깨졌다(측정 기록은 dev/backlog.md). 그래프
 * 탭은 예전처럼 활성일 때만 렌더한다 — 떠나면 언마운트, 돌아오면 재레이아웃.
 *
 * kind별 독립 상한. PDF가 작은 이유는 메모리다 — 150p 문서의 안정 힙이 ~46MB(§282.3 실측)이고
 * 유휴 메모리 목표가 100MB다.
 *
 * ‼️ html은 처음에 1이었다. `sandbox="allow-scripts"` iframe이 숨어서도 setInterval을 돌리니
 * 적을수록 좋다는 판단이었는데, 상한 1은 **HTML 탭 두 개를 오갈 때마다 축출·재마운트**를
 * 뜻한다 — 실앱에서 "HTML↔HTML만 위치가 초기화된다(PDF는 유지되는데)"로 드러났다. 두 개를
 * 오가는 것이 이 기능이 겨냥하는 바로 그 사용 방식이므로 2로 올린다. 백그라운드 스크립트
 * 우려는 남지만 상한이 그것을 2로 묶고, 메시지 브릿지는 §288 규칙 1이 이미 막는다.
 */
export const RETENTION_CAPS: Readonly<Record<RetainedKind, number>> = {
  code: 3,
  html: 2,
  pdf: 2,
  plugin: 2,
};

/**
 * 유지할 표면 목록을 **순수하게** 계산한다.
 *
 * ‼️ 예전에는 직전 결과를 ref에 들고 렌더 도중 갱신했다. 실앱 로그가 그 대가를 보여줬다:
 * 표면이 같은 탭인데도 MOUNT → UNMOUNT → MOUNT를 반복했고, 그때마다 PDF 문서가 파기·재로드되고
 * 스크롤 복원을 기다리던 ResizeObserver가 끊겼다. React는 렌더를 버리거나 다시 실행할 수
 * 있으므로 렌더 도중의 ref 변경은 남으면 안 될 상태를 남긴다.
 *
 * MRU는 이미 스토어가 관리한다(`touchMru` — 활성 탭이 앞). 그것을 입력으로 받으면 같은 입력에
 * 같은 결과가 나오고, 몇 번을 다시 계산해도 집합이 흔들리지 않는다.
 *
 * @param mruOrder 최근 사용 순 tabId. 앞이 가장 최근.
 */
export function computeRetained(
  mruOrder: readonly string[],
  tabs: readonly EditorTab[],
  input: RetentionInput,
): RetainedEntry[] {
  const byId = new Map(tabs.map((t) => [t.id, t]));

  // MRU에 있는 것 먼저, 그다음 아직 touchMru를 받지 못한 열린 탭들.
  const seen = new Set<string>();
  const ordered: EditorTab[] = [];
  for (const id of mruOrder) {
    const tab = byId.get(id);
    if (!tab || seen.has(id)) continue;
    seen.add(id);
    ordered.push(tab);
  }
  for (const tab of tabs) {
    if (!seen.has(tab.id)) ordered.push(tab);
  }

  const counts = new Map<RetainedKind, number>();
  const result: RetainedEntry[] = [];
  for (const tab of ordered) {
    const kind = retainedKindForTab(tab, input);
    if (kind === null) continue;
    const n = counts.get(kind) ?? 0;
    if (n >= RETENTION_CAPS[kind]) continue;
    counts.set(kind, n + 1);
    result.push({ kind, tabId: tab.id });
  }
  return result;
}

/** 이 탭이 유지 집합에 들어간다면 어떤 표면으로 들어가는지. null이면 유지하지 않는다. */
export function retainedKindForTab(
  tab: EditorTab,
  input: RetentionInput,
): null | RetainedKind {
  if (isPluginTab(tab)) return "plugin";
  if (!isFileTab(tab)) return null;

  const { filePath } = tab;
  if (isPdfFile(filePath)) return "pdf";

  // 원본 텍스트를 보는 모든 표면은 한 종류다 — 셋 다 같은 SourceCodeEditor에 같은 버퍼를 쓴다.
  const showingSource = input.htmlSourceTabs.has(tab.id);

  // ‼️ isMarkdownFile("")는 true다(untitled → 마크다운). 그래서 이 분기가 filePath 없는
  // 파일 탭까지 먹는데, 그게 맞다 — 제목 없는 새 문서는 WYSIWYG 편집기가 담당한다.
  if (isMarkdownFile(filePath)) {
    return input.sourceModeTabs.has(tab.id) ? "code" : null;
  }
  if (isHtmlFile(filePath)) return showingSource ? "code" : "html";

  // ‼️ 이미지·바이너리는 유지하지 않는다(§290). 이 가드가 없으면 .png 탭이 `code`로 분류되어
  // SourceCodeEditor에 바이너리를 싣는다 — "남은 건 전부 텍스트"라는 낙관이 만드는 결함이다.
  if (isBinaryViewerFile(filePath)) return null;

  // 플러그인이 그리고 있는 텍스트 파일(SVG 등)은 프리뷰 상태에서 유지하지 않는다. 원본 보기로
  // 전환하면 평범한 코드 표면이므로 유지한다.
  if (input.pluginPreviewTabs.has(tab.id) && !showingSource) return null;

  return "code";
}

export function useRetainedTabs(
  mruOrder: readonly string[],
  tabs: readonly EditorTab[],
  sourceModeTabs: ReadonlySet<string>,
  htmlSourceTabs: ReadonlySet<string>,
  pluginPreviewTabs: ReadonlySet<string>,
): RetainedEntry[] {
  return useMemo(
    () =>
      computeRetained(mruOrder, tabs, {
        htmlSourceTabs,
        pluginPreviewTabs,
        sourceModeTabs,
      }),
    [mruOrder, tabs, sourceModeTabs, htmlSourceTabs, pluginPreviewTabs],
  );
}
