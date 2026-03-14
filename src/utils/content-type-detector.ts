// §11.2.3 Contextual AI Toolbar — content type detection
export type ContentMode =
  | "code"
  | "diagram"
  | "image"
  | "math"
  | "structure"
  | "table"
  | "text";

interface NodeInfo {
  type: string;
}

export function detectContentType(nodes: NodeInfo[]): ContentMode {
  const types = new Set(nodes.map((n) => n.type));

  if (types.has("codeBlock")) return "code";
  if (types.has("mathBlock") || types.has("mathInline")) return "math";
  if (types.has("table")) return "table";
  if (types.has("mermaidBlock")) return "diagram";
  if (types.has("image")) return "image";
  if (types.has("heading") && types.has("paragraph")) return "structure";
  return "text";
}
