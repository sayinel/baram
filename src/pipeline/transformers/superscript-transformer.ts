// superscript-transformer.ts — §5.1 Superscript mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const superscriptTransformer = createSimpleMarkTransformer(
  "superscript",
  "superscript",
);
