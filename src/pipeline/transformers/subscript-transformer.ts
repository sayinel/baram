// subscript-transformer.ts — §5.1 Subscript mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const subscriptTransformer = createSimpleMarkTransformer(
  "subscript",
  "subscript",
);
