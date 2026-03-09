// Help Panel — User Guide, Keyboard Shortcuts, FAQ
// Renders docs/*.md as single source of truth via MarkdownRenderer
// Preprocesses markdown for panel fit + intercepts links
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import MarkdownRenderer from "../ai/MarkdownRenderer";
import { prepareHelpMarkdown } from "./prepare-help-markdown";
import { useTranslation } from "../../i18n/useTranslation";
import userGuideRaw from "../../../docs/user-guide.md?raw";
import shortcutsRaw from "../../../docs/keyboard-shortcuts.md?raw";
import faqRaw from "../../../docs/faq.md?raw";

type HelpTab = "guide" | "shortcuts" | "faq";

const TAB_IDS: { id: HelpTab; i18nKey: string }[] = [
  { id: "guide", i18nKey: "help.tab.guide" },
  { id: "shortcuts", i18nKey: "help.tab.shortcuts" },
  { id: "faq", i18nKey: "help.tab.faq" },
];

const TAB_CONTENT: Record<HelpTab, string> = {
  guide: userGuideRaw,
  shortcuts: shortcutsRaw,
  faq: faqRaw,
};

const HELP_SCHEME_TO_TAB: Record<string, HelpTab> = {
  "help:guide": "guide",
  "help:shortcuts": "shortcuts",
  "help:faq": "faq",
};

/** Slugify a heading text for use as an id attribute */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function HelpPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const [activeTab, setActiveTab] = useState<HelpTab>("guide");
  const contentRef = useRef<HTMLDivElement>(null);

  // Preprocess markdown for panel display
  const processedContent = useMemo(
    () => prepareHelpMarkdown(TAB_CONTENT[activeTab]),
    [activeTab],
  );

  // Listen for external help-tab events
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<HelpTab>).detail;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("help-tab", handler);
    return () => window.removeEventListener("help-tab", handler);
  }, []);

  // Post-render: add heading IDs for anchor navigation
  // NOTE: only set attributes — never reparent/wrap DOM nodes (breaks React reconciliation)
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    el.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      if (!heading.id) {
        heading.id = slugify(heading.textContent || "");
      }
    });
  }, [activeTab, processedContent]);

  // Link click handler — event delegation on content div
  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      e.preventDefault();

      // help:tab links → switch tab + scroll to top
      const [scheme, fragment] = href.split("#");
      const tab = HELP_SCHEME_TO_TAB[scheme];
      if (tab) {
        setActiveTab(tab);
        // If there's a #fragment, scroll to it after tab switch
        if (fragment) {
          requestAnimationFrame(() => {
            const targetEl = contentRef.current?.querySelector(
              `#${CSS.escape(slugify(fragment))}`,
            );
            targetEl?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        } else {
          contentRef.current?.scrollTo(0, 0);
        }
        return;
      }

      // Anchor links (#section) → scroll within panel
      if (href.startsWith("#")) {
        const id = slugify(href.slice(1));
        const targetEl = contentRef.current?.querySelector(
          `#${CSS.escape(id)}`,
        );
        targetEl?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      // External URLs → open in system browser
      if (href.startsWith("http://") || href.startsWith("https://")) {
        openUrl(href).catch(() => {});
        return;
      }
    },
    [],
  );

  const { t } = useTranslation();

  if (!rightPanelOpen || rightPanelMode !== "help") return null;

  return (
    <div className="help-panel">
      <div className="help-panel-header">
        <div className="help-panel-tabs">
          {TAB_IDS.map((tab) => (
            <button
              key={tab.id}
              className={`help-tab ${activeTab === tab.id ? "help-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.i18nKey)}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={contentRef}
        className="help-panel-content"
        onClick={handleContentClick}
      >
        <MarkdownRenderer content={processedContent} />
      </div>
    </div>
  );
}
