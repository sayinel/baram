import type { ReactNode } from "react";
import { lazy, Suspense } from "react";

import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §286 유지 표면은 **자기 안에서** 실패해야 한다.
//
// 실앱에서 관측된 것: `PluginDetailTabLazy`의 `import()`가 실패하자(vite 최적화 의존성
// 캐시가 서버 실행 중에 사라져 `504 Outdated Optimize Dep`) 에디터·사이드바·탭 바까지
// 포함한 **앱 전체**가 "Something went wrong"으로 대체됐다. 경계가 앱 루트(App.tsx의
// AppWithErrorBoundary) 하나뿐이라 lazy 청크 하나의 로드 실패가 전부를 데려간 것이다.
//
// ‼️ 앱 루트 경계의 "Retry"는 이 실패에 대해 원리적으로 듣지 않는다. React의
// `lazyInitializer`는 factory를 `_status === -1`일 때만 부르고 reject되면 `_status = 2`로
// 굳혀 이후엔 캐시된 에러를 그대로 throw한다(react 19.2.8 소스). 그래서 재시도는
// **렌더 크래시**에만 정직하고, 로드 실패의 복구는 탭 닫기/리로드다 — 셋을 다 두는 이유.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { TabSurface } from "../TabSurface";

const entry = (kind: RetainedEntry["kind"], tabId: string): RetainedEntry => ({
  kind,
  tabId,
});

/** kind별 스텁. 테스트가 갈아끼우는 kind만 넘긴다. */
function renderersWith(
  overrides: Partial<TabSurfaceRenderers>,
): TabSurfaceRenderers {
  const stub = (marker: string) => (): ReactNode => (
    <div data-testid={marker} />
  );
  return {
    code: stub("code-surface"),
    html: stub("html-surface"),
    pdf: stub("pdf-surface"),
    plugin: stub("plugin-surface"),
    ...overrides,
  };
}

const CHUNK_FAILURE = "Importing a module script failed.";

beforeEach(() => {
  // ErrorBoundary는 logger.error를 무조건 부르고 React도 자기 경고를 찍는다. 이 파일의
  // 테스트는 던지는 것이 정상 경로이므로 출력을 조용히 유지한다.
  vi.spyOn(console, "error").mockImplementation(() => {});
  useEditorStore.setState({
    activeTabId: "c1",
    mruOrder: ["c1", "p1"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/a.ts",
        id: "c1",
        isDirty: false,
        isPinned: false,
        title: "a.ts",
        type: "file",
      },
      {
        contextId: "c",
        filePath: "",
        id: "p1",
        isDirty: false,
        isPinned: false,
        pluginId: "baram-word-count",
        title: "Word Count",
        type: "plugin",
      },
    ],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a failing surface stays inside its own tab", () => {
  it("leaves the rest of the app mounted when a surface throws", () => {
    const { container } = render(
      <div>
        <div data-testid="app-chrome" />
        <TabSurface
          active
          entry={entry("plugin", "p1")}
          renderers={renderersWith({
            plugin: () => {
              throw new Error(CHUNK_FAILURE);
            },
          })}
        />
      </div>,
    );

    // 경계를 지우면 이 두 줄에 닿지도 못한다 — render()가 그대로 throw한다.
    expect(screen.getByTestId("app-chrome")).toBeTruthy();
    expect(container.querySelector("[data-surface-error]")).not.toBeNull();
  });

  it("reports the error message so a load failure is diagnosable", () => {
    render(
      <TabSurface
        active
        entry={entry("plugin", "p1")}
        renderers={renderersWith({
          plugin: () => {
            throw new Error(CHUNK_FAILURE);
          },
        })}
      />,
    );

    expect(screen.getByText(CHUNK_FAILURE)).toBeTruthy();
  });
});

describe("recovery affordances", () => {
  it("retry re-renders the surface subtree", () => {
    // 렌더 크래시(예: 컨테이너를 재는 뷰가 던지는 경우)는 리마운트로 실제 회복된다.
    // 시도 횟수가 아니라 플래그로 적는다 — React가 에러 복구 중 서브트리를 한 번 더
    // 렌더할 수 있어서, 횟수 단정은 구현 세부에 묶인다.
    let failing = true;
    const { container } = render(
      <TabSurface
        active
        entry={entry("plugin", "p1")}
        renderers={renderersWith({
          plugin: () => {
            if (failing) throw new Error(CHUNK_FAILURE);
            return <div data-testid="plugin-surface" />;
          },
        })}
      />,
    );

    failing = false;
    fireEvent.click(
      container.querySelector(
        '[data-surface-error-action="retry"]',
      ) as HTMLElement,
    );

    expect(screen.getByTestId("plugin-surface")).toBeTruthy();
    expect(container.querySelector("[data-surface-error]")).toBeNull();
  });

  it("closes its OWN tab rather than whichever tab is active", () => {
    // ‼️ §288 규칙 2와 같은 함정. 표면은 활성 탭 파생값을 받지 않으므로 닫기도
    // `entry.tabId`를 써야 한다 — `activeTabId`를 쓰면 남의 탭이 닫힌다.
    const { container } = render(
      <TabSurface
        active
        entry={entry("plugin", "p1")}
        renderers={renderersWith({
          plugin: () => {
            throw new Error(CHUNK_FAILURE);
          },
        })}
      />,
    );

    fireEvent.click(
      container.querySelector(
        '[data-surface-error-action="close"]',
      ) as HTMLElement,
    );

    const ids = useEditorStore.getState().tabs.map((t) => t.id);
    expect(ids).not.toContain("p1");
    expect(ids).toContain("c1");
  });

  it("offers a reload, the only recovery for a poisoned module load", () => {
    const { container } = render(
      <TabSurface
        active
        entry={entry("plugin", "p1")}
        renderers={renderersWith({
          plugin: () => {
            throw new Error(CHUNK_FAILURE);
          },
        })}
      />,
    );

    expect(
      container.querySelector('[data-surface-error-action="reload"]'),
    ).not.toBeNull();
  });
});

describe("the real failure mode: a lazy chunk that never arrives", () => {
  it("contains a rejected dynamic import inside the surface", async () => {
    // 위의 테스트들은 렌더 중 **동기** throw다. 실앱에서 터진 것은 다른 경로다:
    // `lazy()`의 promise가 reject되고 Suspense를 통해 비동기로 올라온다. 경로가 다르므로
    // 따로 고정한다 — `vi.mock`으로 lazy를 덮으면 이 경로 자체가 테스트에서 사라진다.
    const Missing = lazy(() => Promise.reject(new Error(CHUNK_FAILURE)));

    const { container } = render(
      <div>
        <div data-testid="app-chrome" />
        <TabSurface
          active
          entry={entry("plugin", "p1")}
          renderers={renderersWith({
            plugin: () => (
              <Suspense fallback={null}>
                <Missing />
              </Suspense>
            ),
          })}
        />
      </div>,
    );

    await waitFor(() => {
      expect(container.querySelector("[data-surface-error]")).not.toBeNull();
    });
    expect(screen.getByTestId("app-chrome")).toBeTruthy();
    expect(screen.getByText(CHUNK_FAILURE)).toBeTruthy();
  });
});
