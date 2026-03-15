// highlight-transformer.ts — §5.1 Highlight mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const highlightTransformer = createSimpleMarkTransformer(
  "highlight",
  "highlight",
);
