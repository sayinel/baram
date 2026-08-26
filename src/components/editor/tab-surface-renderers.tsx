// §286 유지 표면의 kind별 실제 컴포넌트.
//
// TabSurface.tsx에서 분리한 이유는 이 저장소의 기존 규칙과 같다(table-insert-coords.ts 헤더
// 참조): 컴포넌트 파일은 컴포넌트만 export해야 react-refresh가 동작한다.
import type { MutableRefObject, ReactNode, RefObject } from "react";
import { Suspense } from "react";

import type { RetainedKind } from "../../hooks/use-retained-tabs";
import type { PdfFindApi } from "./pdf/use-pdf-find";
import type { SourceCodeEditorRef } from "./SourceCodeEditor";

import { isMarkdownFile } from "../../utils/file-type";
import { PluginDetailTabLazy } from "../plugins/PluginDetailTabLazy";
import { HtmlPreview } from "./HtmlPreview";
import { PdfPreviewLazy } from "./pdf/PdfPreviewLazy";
import { SourceCodeEditor } from "./SourceCodeEditor";

/** 표면 하나가 자기 탭에 대해 아는 전부. 활성 탭 정보는 여기 없다(§288 규칙 2). */
export interface TabSurfaceContext {
  active: boolean;
  /** §291 코드 표면의 스크롤 요소를 얻기 위한 ref — TabSurface가 소유한다. */
  codeEditorRef: RefObject<null | SourceCodeEditorRef>;
  /** 자기 탭의 절대 경로. 파일 탭이 아니면 "". */
  filePath: string;
  /** 자기 탭의 마지막 저장 mtime — 뷰어 리로드 키. */
  refreshKey: number;
  tabId: string;
}

/** App이 표면에 내려줘야 하는 배선. 활성 탭 파생값은 여기 없다(§288 규칙 2). */
export interface TabSurfaceDeps {
  /** 파일 경로 → CodeMirror 언어 이름. */
  codeLanguageFor: (filePath: string) => string | undefined;
  getSourceBuffer: (tabId: string) => string;
  /**
   * 이 탭의 문서를 **이미 읽어 왔는가.**
   *
   * ‼️ `getSourceBuffer(id) !== ""`로 대신할 수 없다 — 빈 파일도 정당한 문서다. 조건은
   * "내용이 있는가"가 아니라 "읽어 왔는가"이고, 그건 맵에 키가 있는지로만 알 수 있다.
   */
  hasSourceBuffer: (tabId: string) => boolean;
  /** 자기 탭을 dirty로 표시 — 활성 탭이 아니라 편집이 일어난 탭이다. */
  markDirty: (tabId: string, dirty: boolean) => void;
  /** §272 활성 PDF가 자기 find API를 App으로 끌어올리는 통로. */
  onPdfFindApiChange: (api: null | PdfFindApi) => void;
  onTogglePdfFind: () => void;
  /** §272 PDF 찾기 바가 열려 있는가. */
  pdfFindOpen: boolean;
  /** §69 플러그인 탭이 보여줄 플러그인 id — 자기 탭에서 읽는다. */
  pluginIdFor: (tabId: string) => string;
  /**
   * §291 탭별 스크롤 오프셋. App이 소유하므로 상한을 넘겨 축출돼도 자리는 남는다.
   * HTML은 iframe 안이라 DOM에서 읽을 수 없어, bridge가 실어 온 값을 여기에 적는다.
   */
  scrollOffsets: MutableRefObject<Map<string, number>>;
  setSourceBuffer: (tabId: string, content: string) => void;
  sourceCursorOffsetFor: (tabId: string) => number;
}

export type TabSurfaceRenderers = Record<
  RetainedKind,
  (ctx: TabSurfaceContext) => ReactNode
>;

/**
 * kind별 실제 표면.
 *
 * 레지스트리를 두는 이유는 테스트 편의가 아니라 **격리**다. `vi.mock`으로 pdfjs 경로 전체를
 * 덮는 방식은 이 저장소가 이미 사고를 낸 패턴이다 — PDF 찾기가 4,988개 초록 아래에서 `0/0`인
 * 채 실앱에서 완전히 죽어 있었다. 주입은 검사 대상을 "TabSurface의 배선"으로 좁히면서 pdfjs
 * 실물 경로는 손대지 않는다.
 */
export function createTabSurfaceRenderers(
  deps: TabSurfaceDeps,
): TabSurfaceRenderers {
  return {
    // ‼️ content/onChange/커서가 전부 **자기 tabId**를 쓴다. 예전에는 전역 버퍼 하나였고
    // 편집 영역이 코드 표면을 하나만 마운트한다는 사실에 기대고 있었다(§287).
    //
    // ‼️ 문서를 읽어 오기 전에는 아무것도 마운트하지 않는다. SourceCodeEditor는 마운트 때의
    // `content`로 EditorState를 굳히고, 2단계 init이 문서를 그 값으로 **되돌리기까지** 한다.
    // 빈 버퍼로 마운트되면 실앱에서 .ts/.json/.py가 전부 빈 화면으로 죽었다.
    //
    // §312가 뒤늦은 내용 변경을 뷰에 밀어 넣게 되면서 "영원히" 빈 화면은 아니게 됐지만
    // 이 관문은 그대로 둔다 — 커서 초기 위치가 마운트 때 한 번만 읽히고, 빈 화면이
    // 잠깐 번쩍이는 것도 그 자체로 결함이다.
    //
    // 예전 코드가 살아 있던 이유는 App이 이 컴포넌트를 lazy()로 불러서 **모듈 로딩이라는
    // 우연한 지연**이 마운트를 버퍼 채우기 뒤로 밀어줬기 때문이다. 그런 타이밍 의존을
    // 되살리는 대신, 조건을 데이터로 적는다.
    code: ({ codeEditorRef, filePath, tabId }) =>
      !deps.hasSourceBuffer(tabId) ? null : (
        <Suspense fallback={null}>
          <SourceCodeEditor
            content={deps.getSourceBuffer(tabId)}
            // §312 `content`는 렌더 시점의 스냅샷이라 "다시 봐라"는 신호로만 쓴다. 실제로
            // 무엇을 보여줄지는 effect 시점에 이 접근자로 다시 묻는다 — 그 사이에 사용자가
            // 친 글자를 낡은 스냅샷으로 지우지 않기 위해서다(SourceCodeEditor의 prop 주석).
            getLatestContent={() => deps.getSourceBuffer(tabId)}
            initialCursorOffset={deps.sourceCursorOffsetFor(tabId)}
            language={deps.codeLanguageFor(filePath)}
            onChange={(next) => {
              deps.setSourceBuffer(tabId, next);
              // ‼️ 마크다운은 여기서 dirty로 표시하지 않는다 — 예전 두 갈래의 비대칭을 그대로
              // 보존한 것이다. 마크다운의 dirty는 use-auto-save가 Tiptap `update` 트랜잭션에서
              // 판정하고(내용이 실제로 달라졌는지 비교까지 한다), 소스 모드에서 돌아올 때 그
              // 경로가 돈다. 여기서 같이 표시하면 두 곳이 같은 상태를 쓰게 된다.
              if (!isMarkdownFile(filePath)) deps.markDirty(tabId, true);
            }}
            ref={codeEditorRef}
          />
        </Suspense>
      ),
    html: ({ active, filePath, refreshKey, tabId }) => (
      <HtmlPreview
        active={active}
        filePath={filePath}
        getScrollY={() => deps.scrollOffsets.current.get(tabId) ?? 0}
        onScrollY={(y) => deps.scrollOffsets.current.set(tabId, y)}
        refreshKey={refreshKey}
        title={filePath}
      />
    ),
    pdf: ({ active, filePath, refreshKey }) => (
      <Suspense fallback={null}>
        <PdfPreviewLazy
          active={active}
          filePath={filePath}
          // ‼️ 활성 표면만 find API를 끌어올린다. 숨은 PDF까지 올리면 마지막으로 마운트된
          // 문서가 App의 단일 pdfFindApi를 차지해, 찾기 바가 보이지 않는 문서를 검색한다.
          findOpen={active ? deps.pdfFindOpen : false}
          onFindApiChange={active ? deps.onPdfFindApiChange : undefined}
          onToggleFind={active ? deps.onTogglePdfFind : undefined}
          refreshKey={refreshKey}
          title={filePath}
        />
      </Suspense>
    ),
    plugin: ({ tabId }) => (
      <Suspense fallback={null}>
        <PluginDetailTabLazy pluginId={deps.pluginIdFor(tabId)} />
      </Suspense>
    ),
  };
}
