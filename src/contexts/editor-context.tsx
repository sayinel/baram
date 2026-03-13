import { createContext, useContext } from "react";

import type { Editor } from "@tiptap/react";

const EditorContext = createContext<Editor | null>(null);
export const EditorProvider = EditorContext.Provider;
export function useEditorContext(): Editor | null {
  return useContext(EditorContext);
}
