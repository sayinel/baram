// §286 유지 표면 디스패처.
//
// 유지 집합(use-retained-tabs.ts)의 항목 하나를 렌더한다. 활성이 아니면 `display: none`으로
// 숨기되 **마운트는 유지한다** — 그것이 이 기능의 전부다. PDF는 언마운트되면 cleanup이
// `task.destroy()`로 문서와 worker를 해제해, 돌아올 때 워커 파싱부터 다시 하기 때문이다.
//
// ‼️ 이 컴포넌트는 활성 탭 파생값을 **받지 않는다.** App.tsx의 previewFileMtime·
// activeTabFilePath 같은 값은 전부 "활성 탭"의 것이라, 숨은 표면에 그대로 넘기면 남의 mtime을
// refreshKey로 받아 엉뚱하게 리로드한다(§288 규칙 2). 자기 `entry.tabId`로 직접 읽는다.
import { useRef } from "react";

import type {
  RetainedEntry,
  RetainedKind,
} from "../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "./tab-surface-renderers";

import { useTabScrollMemory } from "../../hooks/use-tab-scroll-memory";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";

interface TabSurfaceProps {
  active: boolean;
  entry: RetainedEntry;
  /** createTabSurfaceRenderers(...)의 결과. 테스트는 일부 kind만 갈아끼운다. */
  renderers: TabSurfaceRenderers;
}

export function TabSurface({ active, entry, renderers }: TabSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const filePath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === entry.tabId)?.filePath ?? "",
  );
  const refreshKey = useFileStore(
    (s) => s.fileMtimes.get(filePath)?.lastSaveMtime ?? 0,
  );

  // §291 이 래퍼가 스크롤 컨테이너다(PdfPreview는 containerRef.parentElement로 같은 요소를
  // 쓴다). 코드 표면은 CodeMirror의 scrollDOM이 따로 있어 Task 9에서 분기한다.
  useTabScrollMemory(entry.tabId, active, () => {
    const el = wrapperRef.current;
    if (!el) return null;
    return {
      element: el,
      getScrollTop: () => el.scrollTop,
      setScrollTop: (n: number) => {
        el.scrollTop = n;
      },
    };
  });

  return (
    <div
      className={`editor-area-scroll${wrapperClassFor(entry.kind)}`}
      // ‼️ 활성일 때만 단다 — activeEditorScrollContainer(§288 규칙 4)가 이 표시로 숨은
      // 컨테이너를 걸러낸다.
      {...(active ? { "data-editor-active": "" } : {})}
      data-editor-scroll
      ref={wrapperRef}
      style={{ display: active ? undefined : "none" }}
    >
      {renderers[entry.kind]({
        active,
        filePath,
        refreshKey,
        tabId: entry.tabId,
      })}
    </div>
  );
}

/** 래퍼에 붙는 kind별 추가 클래스 — 기존 삼항 사슬이 쓰던 것과 같은 값이어야 한다. */
function wrapperClassFor(kind: RetainedKind): string {
  return kind === "pdf" ? " pdf-preview-scroll" : "";
}
