// §11.2.3 Contextual AI Toolbar — content type detection
export type ContentMode = "code" | "math" | "structure" | "table" | "text";

interface NodeInfo {
  type: string;
}

export function detectContentType(nodes: NodeInfo[]): ContentMode {
  const types = new Set(nodes.map((n) => n.type));

  if (types.has("codeBlock")) return "code";
  if (types.has("mathBlock") || types.has("mathInline")) return "math";
  if (types.has("table")) return "table";
  if (types.has("heading") && types.has("paragraph")) return "structure";
  return "text";
}
