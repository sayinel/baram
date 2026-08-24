// §286 유지 표면 디스패처.
//
// 유지 집합(use-retained-tabs.ts)의 항목 하나를 렌더한다. 활성이 아니면 `display: none`으로
// 숨기되 **마운트는 유지한다** — 그것이 이 기능의 전부다. PDF는 언마운트되면 cleanup이
// `task.destroy()`로 문서와 worker를 해제해, 돌아올 때 워커 파싱부터 다시 하기 때문이다.
//
// ‼️ 이 컴포넌트는 활성 탭 파생값을 **받지 않는다.** App.tsx의 previewFileMtime·
// activeTabFilePath 같은 값은 전부 "활성 탭"의 것이라, 숨은 표면에 그대로 넘기면 남의 mtime을
// refreshKey로 받아 엉뚱하게 리로드한다(§288 규칙 2). 자기 `entry.tabId`로 직접 읽는다.
import type {
  CSSProperties,
  MutableRefObject,
  ReactNode,
  RefObject,
} from "react";
import { useEffect, useRef, useState } from "react";

import type {
  RetainedEntry,
  RetainedKind,
} from "../../hooks/use-retained-tabs";
import type { SourceCodeEditorRef } from "./SourceCodeEditor";
import type {
  TabSurfaceContext,
  TabSurfaceRenderers,
} from "./tab-surface-renderers";

import { useTabScrollMemory } from "../../hooks/use-tab-scroll-memory";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { ErrorBoundary } from "../ErrorBoundary";
import { TabSurfaceError } from "./TabSurfaceError";

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
   * §291 탭별 스크롤 오프셋. **App이 소유한다** — 이 컴포넌트가 아니라.
   *
   * ‼️ 여기 두면 상한을 넘겨 축출될 때 위치도 함께 사라진다. 상한은 "재로딩을 얼마나 피할
   * 것인가"의 문제여야지 "자리를 잃느냐"의 문제여서는 안 된다.
   */
  scrollOffsets?: MutableRefObject<Map<string, number>>;
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
  scrollOffsets,
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
  useTabScrollMemory(
    scrollKeyFor(entry),
    active,
    () => {
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
    },
    scrollOffsets,
  );

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
      {/*
        ‼️ 경계는 `.editor-area-scroll` **안쪽**이다. 밖으로 빼면 실패한 표면과 함께
        스크롤 컨테이너(§291)와 overlay의 zoom 기준(위 `overlay` 주석)까지 사라진다.

        표면 하나가 던지면 예전에는 App 루트의 경계까지 올라가 사이드바·탭 바를 포함한
        앱 전체가 "Something went wrong"으로 대체됐다. 실앱에서 플러그인 상세의
        `import()` 실패로 관측된 그대로다.
      */}
      {everActive && (
        <ErrorBoundary
          fallback={(error, retry) => (
            <TabSurfaceError
              error={error}
              // ‼️ 자기 `entry.tabId`를 닫는다 — `activeTabId`가 아니다(§288 규칙 2).
              // 숨은 표면이 실패한 뒤 활성 탭에서 이 버튼을 누르면 남의 탭이 닫힌다.
              onClose={() => useEditorStore.getState().closeTab(entry.tabId)}
              onReload={() => window.location.reload()}
              onRetry={retry}
            />
          )}
        >
          <SurfaceContent
            ctx={{
              active,
              codeEditorRef,
              filePath,
              refreshKey,
              tabId: entry.tabId,
            }}
            render={renderers[entry.kind]}
          />
        </ErrorBoundary>
      )}
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

/**
 * §291 이 kind가 **대체 보기**인가 — 같은 탭에 주 표면이 따로 있는가.
 *
 * ‼️ 스크롤 오프셋 맵을 `tabId` 하나로 색인하면 안 되는 이유다. **한 탭을 좌표계가 다른 두
 * 표면이 그릴 수 있다.** 마크다운 탭은 WYSIWYG(MarkdownSurface)과 Cmd+/의 원본 텍스트를
 * 오가고, HTML 탭은 프리뷰와 원본 보기를 오간다. 같은 문서라도 렌더된 높이와 원본 텍스트의
 * 높이는 크게 다르다 — 비디오는 16:9 박스인데 원본에서는 `![](clip.mp4)` 한 줄이다. 슬롯을
 * 공유하면 한쪽의 픽셀 오프셋이 다른 쪽에 놓여 클램프되거나 엉뚱한 곳에 떨어진다(실앱: 비디오
 * 위/아래로 넘어갈 수 없는 스크롤 함정).
 *
 * 규칙은 "kind마다 슬롯"이 아니라 **"대체 보기는 자기 슬롯을 쓴다"**이다. 맨 `tabId`는 그 탭의
 * 주 표면 것이고, use-tab-switching이 WYSIWYG 복원에 같은 슬롯을 읽는다 — 그 계약은 유지해야
 * 한다.
 *
 * ‼️ **이 표를 주석이 아니라 타입으로 둔 이유:** 이 판정이 `kind === "code"` 한 줄이었을 때는
 * 새 kind가 추가되면 아무 신호 없이 기본값(주 표면)으로 떨어졌다 — 이 저장소에서 가장 자주
 * 반복된 실패 모양이다(열거한 가드는 다음 멤버를 놓친다). `satisfies Record<RetainedKind, …>`는
 * `RetainedKind`에 멤버가 늘면 **tsc가 컴파일을 거부한다.** 새 kind를 넣는 사람이 "이건 대체
 * 보기인가"를 반드시 한 번 답하게 된다.
 */
const IS_ALTERNATE_VIEW = {
  // 원본 텍스트 보기. 마크다운 탭의 WYSIWYG, HTML 탭의 프리뷰가 각각 주 표면이다.
  code: true,
  html: false,
  pdf: false,
  plugin: false,
} satisfies Record<RetainedKind, boolean>;

/** §291 오프셋 맵의 키. 대체 보기만 kind로 갈라진 자기 슬롯을 쓴다(위 표 참조). */
function scrollKeyFor(entry: RetainedEntry): string {
  return IS_ALTERNATE_VIEW[entry.kind]
    ? `${entry.kind}:${entry.tabId}`
    : entry.tabId;
}

/**
 * kind별 렌더러를 **컴포넌트 안에서** 부른다.
 *
 * ‼️ 이 한 겹이 없으면 위의 ErrorBoundary가 아무것도 잡지 못한다. 에러 경계는 자기
 * **자손이 렌더되는 동안** 던진 것만 잡는데, `renderers[kind](ctx)`를 JSX children 자리에서
 * 바로 부르면 그 호출은 TabSurface 자신의 렌더 중에 일어나 경계보다 위에서 던진 셈이 된다.
 * 실제로 그렇게 짰다가 테스트가 잡았다 — 표면이 던지면 여전히 앱 전체가 내려갔다.
 */
function SurfaceContent({
  ctx,
  render,
}: {
  ctx: TabSurfaceContext;
  render: (ctx: TabSurfaceContext) => ReactNode;
}) {
  return <>{render(ctx)}</>;
}

/** 래퍼에 붙는 kind별 추가 클래스 — 기존 삼항 사슬이 쓰던 것과 같은 값이어야 한다. */
function wrapperClassFor(kind: RetainedKind): string {
  if (kind === "pdf") return " pdf-preview-scroll";
  // §5.1 HTML 프리뷰는 자기 내용을 스스로 배율 조정하므로 컨테이너의 CSS zoom을 무력화한다
  // (html-preview.css). 원본 보기(`code`)는 평범한 편집기 내용이라 zoom을 그대로 받는다.
  if (kind === "html") return " html-preview-scroll";
  return "";
}
