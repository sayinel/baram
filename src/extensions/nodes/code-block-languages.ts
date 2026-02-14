// §5.4 CodeMirror 6 language support mapping
import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";

/** Get CodeMirror language extension by name */
export function getLanguageExtension(lang: string): Extension | null {
  const normalized = lang.toLowerCase().trim();

  switch (normalized) {
    case "javascript":
    case "js":
      return javascript();
    case "typescript":
    case "ts":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "python":
    case "py":
      return python();
    case "java":
      return java();
    case "c":
    case "cpp":
    case "c++":
      return cpp();
    case "html":
      return html();
    case "css":
      return css();
    case "json":
      return json();
    case "yaml":
    case "yml":
      return yaml();
    case "markdown":
    case "md":
      return markdown();
    case "rust":
    case "rs":
      return rust();
    case "sql":
      return sql();
    case "xml":
      return xml();
    case "go":
    case "golang":
      return go();
    case "php":
      return php();
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
