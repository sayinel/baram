// bold-transformer.ts — §5.1 Bold mark mdast ↔ ProseMirror
import { createSimpleMarkTransformer } from "./simple-mark-transformer";

export const boldTransformer = createSimpleMarkTransformer("strong", "bold");
