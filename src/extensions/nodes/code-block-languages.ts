// §5.4 CodeMirror 6 language support mapping
// §8.4 Languages are dynamically imported to reduce initial bundle size (~300KB savings)
import type { Extension } from "@codemirror/state";

/** Get CodeMirror language extension by name (async — lazy loads language pack) */
export async function getLanguageExtension(
  lang: string,
): Promise<Extension | null> {
  const normalized = lang.toLowerCase().trim();

  switch (normalized) {
    case "javascript":
    case "js": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript();
    }
    case "typescript":
    case "ts": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true });
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: true });
    }
    case "python":
    case "py": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    case "c":
    case "cpp":
    case "c++": {
      const { cpp } = await import("@codemirror/lang-cpp");
      return cpp();
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "yaml":
    case "yml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "markdown":
    case "md": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "rust":
    case "rs": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml");
      return xml();
    }
    case "go":
    case "golang": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "php": {
      const { php } = await import("@codemirror/lang-php");
      return php();
    }
    default:
      return null;
  }
}

/** List of supported language names for UI */
export const SUPPORTED_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "html",
  "css",
  "json",
  "yaml",
  "markdown",
  "sql",
  "xml",
  "php",
] as const;
