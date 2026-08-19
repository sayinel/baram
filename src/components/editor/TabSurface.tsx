// §286 유지 표면 디스패처.
//
// 유지 집합(use-retained-tabs.ts)의 항목 하나를 렌더한다. 활성이 아니면 `display: none`으로
// 숨기되 **마운트는 유지한다** — 그것이 이 기능의 전부다. PDF는 언마운트되면 cleanup이
// `task.destroy()`로 문서와 worker를 해제해, 돌아올 때 워커 파싱부터 다시 하기 때문이다.
//
// ‼️ 이 컴포넌트는 활성 탭 파생값을 **받지 않는다.** App.tsx의 previewFileMtime·
// activeTabFilePath 같은 값은 전부 "활성 탭"의 것이라, 숨은 표면에 그대로 넘기면 남의 mtime을
// refreshKey로 받아 엉뚱하게 리로드한다(§288 규칙 2). 자기 `entry.tabId`로 직접 읽는다.
import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useRef, useState } from "react";

import type {
  RetainedEntry,
  RetainedKind,
} from "../../hooks/use-retained-tabs";
import type { SourceCodeEditorRef } from "./SourceCodeEditor";
import type { TabSurfaceRenderers } from "./tab-surface-renderers";

import { useTabScrollMemory } from "../../hooks/use-tab-scroll-memory";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";

interface TabSurfaceProps {
  active: boolean;
  entry: RetainedEntry;
  /**
   * 활성 표면 위에 겹쳐 그릴 것(HTML/플러그인 프리뷰의 원본 보기 토글 버튼).
   *
   * ‼️ App이 아니라 **표면 안**에 놓는 이유: `.editor-area-scroll`이
   * `zoom: var(--editor-zoom)`을 걸고 있어서, 밖으로 빼면 같은 좌표라도 줌 배율이 달라진다.
   */
  overlay?: ReactNode;
  /** createTabSurfaceRenderers(...)의 결과. 테스트는 일부 kind만 갈아끼운다. */
  renderers: TabSurfaceRenderers;
  /**
   * §287 활성 코드 표면을 App의 단일 ref로 올려 보낼 통로. handleSave/toggleHtmlView가
   * 그 ref로 "지금 편집 중인 CodeMirror"를 읽는다 — 숨은 표면을 가리키면 저장이 엉뚱한
   * 내용을 집는다.
   */
  sourceEditorRef?: RefObject<null | SourceCodeEditorRef>;
}

export function TabSurface({
  active,
  entry,
  overlay,
  renderers,
  sourceEditorRef,
}: TabSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const codeEditorRef = useRef<null | SourceCodeEditorRef>(null);

  /**
   * 이 표면이 **한 번이라도 보인 적이 있는가.**
   *
   * ‼️ 유지는 "미리 마운트해 둔다"가 아니라 "한 번 보인 뒤로는 언마운트하지 않는다"이다.
   * 여기 실리는 컴포넌트 중에는 마운트 시점에 컨테이너를 재는 것이 있다 — GraphView는
   * Cytoscape 인스턴스를 mount-only로 만들고(그 파일의 useEffect([]) 주석), `display:none`
   * 아래에서는 0×0을 잰다. 실앱에서 그래프가 구석으로 뭉쳐 나타난 원인이 이것이다.
   *
   * 이건 "한 프레임 기다린다" 같은 추정이 아니라 가시성이라는 사실에 대한 조건이다.
   */
  const [everActive, setEverActive] = useState(active);
  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  const filePath = useEditorStore(
    (s) => s.tabs.find((t) => t.id === entry.tabId)?.filePath ?? "",
  );
  const refreshKey = useFileStore(
    (s) => s.fileMtimes.get(filePath)?.lastSaveMtime ?? 0,
  );

  // §287 활성일 때만 App의 ref가 이 표면을 가리킨다. 코드 표면이 여러 개 마운트돼 있으므로
  // "마지막에 마운트된 것"이 아니라 "지금 보이는 것"이어야 한다.
  useEffect(() => {
    if (!sourceEditorRef || entry.kind !== "code" || !active) return;
    // ‼️ 지금 값을 잡아 둔다. cleanup이 도는 시점엔 codeEditorRef.current가 이미 다른 것을
    // 가리킬 수 있고, 그러면 아래 동일성 비교가 "내가 올린 것"이 아닌 남의 것을 지운다.
    const published = codeEditorRef.current;
    sourceEditorRef.current = published;
    return () => {
      if (sourceEditorRef.current === published) {
        sourceEditorRef.current = null;
      }
    };
  }, [active, entry.kind, sourceEditorRef]);

  // §291 스크롤 요소는 표면마다 다르다. PDF·그래프·HTML·플러그인 탭은 래퍼 자신이지만,
  // 코드 표면은 CodeMirror의 `.cm-scroller`(view.scrollDOM)가 스크롤한다 — 래퍼에 리스너를
  // 달면 scroll 이벤트가 오지 않는다.
  useTabScrollMemory(entry.tabId, active, () => {
    if (entry.kind === "code") {
      const el = codeEditorRef.current?.getScrollElement();
      if (!el) return null;
      return {
        element: el,
        getScrollTop: () => codeEditorRef.current?.getScrollTop() ?? 0,
        setScrollTop: (n: number) => codeEditorRef.current?.setScrollTop(n),
      };
    }
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
      style={hiddenStyleFor(active)}
    >
      {active && overlay}
      {everActive &&
        renderers[entry.kind]({
          active,
          codeEditorRef,
          filePath,
          refreshKey,
          tabId: entry.tabId,
        })}
    </div>
  );
}

/**
 * 숨기는 방식은 모든 kind가 같다 — `display: none`. 레이아웃에서 완전히 빠지므로 숨은 표면이
 * 리사이즈 비용을 만들지 않는다.
 *
 * ‼️ HTML만 `visibility: hidden` + 절대 배치로 레이아웃에 남겨 본 적이 있다. iframe의 세로
 * 스크롤이 opaque-origin 문서 안에 있어 우리가 되돌릴 수 없으니 박스를 파기하지 말자는
 * 생각이었다. **실앱에서 반박됐다** — 위치도 여전히 잃었고 화면도 여전히 하얗게 남았다.
 * 지금은 그 위치를 §291 bridge가 프레임과 주고받으므로(html-preview-shim.js) 박스를 살려
 * 둘 이유가 없다.
 */
function hiddenStyleFor(active: boolean): CSSProperties {
  return { display: active ? undefined : "none" };
}

/** 래퍼에 붙는 kind별 추가 클래스 — 기존 삼항 사슬이 쓰던 것과 같은 값이어야 한다. */
function wrapperClassFor(kind: RetainedKind): string {
  if (kind === "pdf") return " pdf-preview-scroll";
  // §5.1 HTML 프리뷰는 자기 내용을 스스로 배율 조정하므로 컨테이너의 CSS zoom을 무력화한다
  // (html-preview.css). 원본 보기(`code`)는 평범한 편집기 내용이라 zoom을 그대로 받는다.
  if (kind === "html") return " html-preview-scroll";
  return "";
}
