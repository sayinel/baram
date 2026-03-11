// §5.4 CodeMirror 6 language support mapping
// §8.4 Languages are dynamically imported to reduce initial bundle size (~300KB savings)
import type { Extension } from "@codemirror/state";

import { StreamLanguage } from "@codemirror/language";

/** Get CodeMirror language extension by name (async — lazy loads language pack) */
export async function getLanguageExtension(
  lang: string,
): Promise<Extension | null> {
  const normalized = lang.toLowerCase().trim();

  switch (normalized) {
    case "bash":
    case "sh":
    case "shell": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    case "c":
    case "c++":
    case "cpp": {
      const { cpp } = await import("@codemirror/lang-cpp");
      return cpp();
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "go":
    case "golang": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    case "javascript":
    case "js": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript();
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "kotlin":
    case "kt": {
      const { kotlin } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(kotlin);
    }
    case "latex":
    case "tex": {
      const { latex } = await import("codemirror-lang-latex");
      return latex();
    }
    case "markdown":
    case "md": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "php": {
      const { php } = await import("@codemirror/lang-php");
      return php();
    }
    case "py":
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "rb":
    case "ruby": {
      const { ruby } = await import("@codemirror/legacy-modes/mode/ruby");
      return StreamLanguage.define(ruby);
    }
    case "rs":
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "swift": {
      const { swift } = await import("@codemirror/legacy-modes/mode/swift");
      return StreamLanguage.define(swift);
    }
    case "ts":
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true });
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: true });
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml");
      return xml();
    }
    case "yaml":
    case "yml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    default:
      return null;
  }
}

/** Language options for the dropdown UI — only includes languages with actual highlighting support */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ label: string; value: string }> =
  [
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "css", label: "CSS" },
    { value: "go", label: "Go" },
    { value: "html", label: "HTML" },
    { value: "java", label: "Java" },
    { value: "javascript", label: "JavaScript" },
    { value: "json", label: "JSON" },
    { value: "kotlin", label: "Kotlin" },
    { value: "latex", label: "LaTeX" },
    { value: "markdown", label: "Markdown" },
    { value: "php", label: "PHP" },
    { value: "python", label: "Python" },
    { value: "ruby", label: "Ruby" },
    { value: "rust", label: "Rust" },
    { value: "shell", label: "Shell" },
    { value: "sql", label: "SQL" },
    { value: "swift", label: "Swift" },
    { value: "typescript", label: "TypeScript" },
    { value: "xml", label: "XML" },
    { value: "yaml", label: "YAML" },
  ];
