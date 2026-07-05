// §56 Reusable collapsible section for the journal sidebar (unified header)
import type { ReactNode } from "react";

import { useJournalLayoutStore } from "../../stores/ui/journal-layout";

interface JournalSectionProps {
  /** Optional action rendered on the right of the header (e.g. refresh). */
  action?: ReactNode;
  children: ReactNode;
  /** Collapsed state when the user has never toggled this section. */
  defaultCollapsed?: boolean;
  /** Stable id used to persist the collapse state. */
  id: string;
  title: string;
}

export function JournalSection({
  id,
  title,
  defaultCollapsed = false,
  action,
  children,
}: JournalSectionProps) {
  const collapsed = useJournalLayoutStore(
    (s) => s.collapsed[id] ?? defaultCollapsed,
  );
  const toggle = useJournalLayoutStore((s) => s.toggle);

  return (
    <section className="journal-section">
      <div className="journal-section-header">
        <button
          aria-expanded={!collapsed}
          className="journal-section-toggle"
          onClick={() => toggle(id, defaultCollapsed)}
          type="button"
        >
          <span
            className={["journal-section-chevron", collapsed && "is-collapsed"]
              .filter(Boolean)
              .join(" ")}
          >
            ▾
          </span>
          <span className="journal-section-title">{title}</span>
        </button>
        {action && <div className="journal-section-action">{action}</div>}
      </div>
      {!collapsed && <div className="journal-section-body">{children}</div>}
    </section>
  );
}
