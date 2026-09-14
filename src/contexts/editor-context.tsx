import { createContext, useContext } from "react";

import type { Editor } from "@tiptap/react";

/**
 * 활성 에디터를 트리 아래로 흘리는 컨텍스트.
 *
 * ‼️ `EditorContext.Provider` 를 `EditorProvider` 같은 이름으로 재export 하지 말 것.
 * 그 별칭 하나가 이 파일을 **컴포넌트 모듈**로 보이게 만들고
 * (eslint-plugin-react-refresh 0.5.6 부터 namespace 컴포넌트 재export 를 인식한다),
 * 그러면 같은 파일의 `useEditorContext` 가 `only-export-components` 로 보고된다 —
 * 경고가 훅 자리에 찍혀서 원인이 provider 쪽이라는 게 안 보인다. 컴포넌트 export 가
 * 하나도 없으면 컨텍스트도 훅도 보고되지 않는다.
 *
 * 소비자는 컨텍스트를 그대로 렌더한다: `<EditorContext value={editor}>`.
 * React 19 가 도입한 형태이고, `<Context.Provider>` 는 deprecate 가 예고돼 있다.
 */
export const EditorContext = createContext<Editor | null>(null);

export function useEditorContext(): Editor | null {
  return useContext(EditorContext);
}
