// strike-transformer.ts — §5.1 Strikethrough mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const strikeTransformer = createSimpleMarkTransformer(
  "delete",
  "strike",
);
