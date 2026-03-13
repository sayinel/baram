// italic-transformer.ts — §5.1 Italic mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const italicTransformer = createSimpleMarkTransformer(
  "emphasis",
  "italic",
);
