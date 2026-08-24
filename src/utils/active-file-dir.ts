// §293/§295 활성 탭 파일의 디렉터리 — `media-src.ts`에서 분리했다.
//
// 분리 이유: `media-src.ts`는 이제 파이프라인(`md-to-pm.ts`, `pm-to-md.ts`)이 직접
// import한다. `activeFileDir`가 거기 남아 있으면 zustand 스토어 체인 전체
// (`useEditorStore` → `useContextStore` → `tauriStorage`, 그리고 `tauriStorage`의
// 모듈 스코프 `window.location.search`)가 파이프라인에 딸려 들어와, DOM이 없는
// 컨텍스트(예: 워커)에서 파이프라인을 import할 수 없게 만든다. `media-src.ts`를
// 순수 함수만 남겨 store-free로 유지하기 위해 이 함수만 별도 모듈로 뺐다.
//
// ‼️ 훅이 아니라 `getState()`를 읽는 명령형 함수다. §56d의 `use-image-preview.ts`가
// 이미 이 방식이고, 훅으로 바꾸면 탭 전환마다 이미지 NodeView가 리렌더되는 **동작 변경**이
// 된다. 갓 착지한 코드의 동작을 이 작업에서 바꾸지 않는다.
//
// 유지된 표면(§286)이 여러 개 마운트돼 있으면 숨은 탭의 상대경로가 활성 탭 기준으로
// 풀리는 문제가 있다 — 이 작업이 만든 것이 아니라 그대로 물려받은 것이다.
import { useEditorStore } from "../stores/editor/editor";
import { dirname } from "./path-utils";

/** 상대경로 해석의 기준 — 활성 탭 파일의 디렉터리. */
export function activeFileDir(): null | string {
  const { activeTabId, tabs } = useEditorStore.getState();
  const filePath = tabs.find((t) => t.id === activeTabId)?.filePath;
  return (filePath && dirname(filePath)) || null;
}
