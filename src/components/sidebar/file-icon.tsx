// §4.3 File tree — extension-to-icon mapping
import { IconFile } from "./file-tree-icons";

export function getFileIcon(name: string): React.JSX.Element {
  const ext = name.includes(".")
    ? name.split(".").pop()?.toLowerCase() || ""
    : "";
  switch (ext) {
    case "bash":
    case "sh":
    case "zsh":
      return <IconFile color="#89e051" label="$" />;
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return <IconFile color="#e8d44d" label="JS" />;
    case "css":
    case "less":
    case "scss":
      return <IconFile color="#56b6c2" label="#" />;
    case "gif":
    case "ico":
    case "jpeg":
    case "jpg":
    case "png":
    case "svg":
    case "webp":
      return <IconFile color="#a074c4" label="img" />;
    case "go":
      return <IconFile color="#00add8" label="GO" />;
    case "htm":
    case "html":
      return <IconFile color="#e37933" label="&lt;&gt;" />;
    case "json":
      return <IconFile color="#cbcb41" label="{}" />;
    case "md":
    case "mdx":
      return <IconFile color="#519aba" label="M" />;
    case "py":
      return <IconFile color="#3572a5" label="PY" />;
    case "rs":
      return <IconFile color="#dea584" label="RS" />;
    case "toml":
      return <IconFile color="#9c4221" label="T" />;
    case "ts":
    case "tsx":
      return <IconFile color="#3178c6" label="TS" />;
    case "yaml":
    case "yml":
      return <IconFile color="#cb171e" label="Y" />;
    default:
      return <IconFile />;
  }
}
