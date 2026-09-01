// §5.5 Mermaid Block — shared async rendering logic (moved out of
// mermaid-block-view.tsx §perf-large-file file-size split). The only
// `import("mermaid")` call site; vi.mock("mermaid") in tests matches by
// module specifier, so mocking is unaffected by which file does the import.

import {
  MERMAID_THEME,
  MERMAID_THEME_VARIABLES,
  normalizeMermaidSvgSize,
  sanitizeMermaidSvg,
} from "../../../utils/markdown/mermaid-utils";

// §perf-large-file C3.4: use randomUUID so concurrent editor instances never
// share an ID. The old module-level counter would generate colliding IDs when
// two MermaidBlockView instances across two editors rendered simultaneously.
function newMermaidId(): string {
  // crypto.randomUUID() is available in all modern browsers and WKWebView.
  // Mermaid requires IDs starting with a letter.
  return `mermaid-${crypto.randomUUID()}`;
}

/** Shared rendering logic */
export async function renderMermaid(
  source: string,
  onSuccess: (svg: string) => void,
  onError: (msg: string) => void,
): Promise<void> {
  if (!source.trim()) {
    onSuccess("");
    return;
  }
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      // One palette for every render path — see MERMAID_THEME's note for why
      // this deliberately ignores the app theme.
      theme: MERMAID_THEME,
      themeVariables: MERMAID_THEME_VARIABLES,
      // "antiscript" allows inline HTML in labels (e.g. <br>, <b>, <i>) while
      // stripping <script>. "strict" would HTML-encode every tag, breaking <br>.
      securityLevel: "antiscript",
    });
    const id = newMermaidId();
    const { svg } = await mermaid.render(id, source);
    // foreignObject hosts HTML labels (flowchart node text). DOMPurify must
    // treat it as an HTML integration point or the label markup is stripped —
    // see sanitizeMermaidSvg. <script>/event handlers stay forbidden.
    // normalizeMermaidSvgSize strips Mermaid's `width="100%"` + inline
    // `max-width` cap so the resize frame controls the size (§5.5).
    onSuccess(normalizeMermaidSvgSize(sanitizeMermaidSvg(svg)));
  } catch (err) {
    onError(err instanceof Error ? err.message : "Mermaid rendering error");
  }
}
