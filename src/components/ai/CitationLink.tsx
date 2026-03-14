// §11.4 Citation link — shows a numbered citation badge linking to a knowledge search result
import { useEditorStore } from "../../stores/editor-store";

interface CitationLinkProps {
  /** File path relative to vault root */
  filePath: string;
  /** Heading within the file (may be empty) */
  heading: string;
  /** 1-based citation number */
  index: number;
}

export function CitationLink({ index, filePath, heading }: CitationLinkProps) {
  const displayPath = heading
    ? `${filePath}#${headingToAnchor(heading)}`
    : filePath;

  const handleOpen = () => {
    const { openTab } = useEditorStore.getState();
    const title = filePath.split("/").pop() ?? filePath;
    openTab({
      id: filePath,
      title,
      filePath,
      isDirty: false,
      isPinned: false,
    });
  };

  return (
    <span className="citation-link">
      <span className="citation-badge">{index}</span>
      <span className="citation-path">{displayPath}</span>
      <button
        className="citation-open-btn"
        onClick={handleOpen}
        title={`Open ${filePath}`}
        type="button"
      >
        열기
      </button>
    </span>
  );
}

/** Convert heading text to URL-compatible anchor (spaces → hyphens) */
function headingToAnchor(heading: string): string {
  return heading.replace(/\s+/g, "-");
}
