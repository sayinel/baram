// Help Panel — User Guide, Keyboard Shortcuts, FAQ
import { useState, useEffect } from "react";
import { useUIStore } from "../../stores/ui-store";

type HelpTab = "guide" | "shortcuts" | "faq";

const TABS: { id: HelpTab; label: string }[] = [
  { id: "guide", label: "User Guide" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "faq", label: "FAQ" },
];

function UserGuideContent() {
  return (
    <div className="help-content-section">
      <h2>Getting Started</h2>
      <p>
        Baram is a lightweight WYSIWYG Markdown editor. Write in rich text and
        save as standard Markdown files.
      </p>

      <h3>Opening Files</h3>
      <p>
        Use <kbd>Cmd+O</kbd> to open a file or <kbd>Cmd+K</kbd> to quickly
        switch between open files. Open a folder to browse files in the sidebar.
      </p>

      <h3>Editing</h3>
      <p>
        Type naturally — Markdown syntax is applied automatically. Use the
        floating toolbar for formatting or type Markdown shortcuts directly:
      </p>
      <table>
        <tbody>
          <tr><td><code># </code></td><td>Heading 1</td></tr>
          <tr><td><code>## </code></td><td>Heading 2</td></tr>
          <tr><td><code>- </code></td><td>Bullet list</td></tr>
          <tr><td><code>1. </code></td><td>Numbered list</td></tr>
          <tr><td><code>&gt; </code></td><td>Blockquote</td></tr>
          <tr><td><code>``` </code></td><td>Code block</td></tr>
          <tr><td><code>$$ </code></td><td>Math block (KaTeX)</td></tr>
          <tr><td><code>--- </code></td><td>Horizontal rule</td></tr>
        </tbody>
      </table>

      <h3>Inline Formatting</h3>
      <table>
        <tbody>
          <tr><td><code>**bold**</code></td><td><strong>bold</strong></td></tr>
          <tr><td><code>*italic*</code></td><td><em>italic</em></td></tr>
          <tr><td><code>`code`</code></td><td><code>code</code></td></tr>
          <tr><td><code>~~strike~~</code></td><td><s>strike</s></td></tr>
          <tr><td><code>==highlight==</code></td><td>highlight</td></tr>
          <tr><td><code>[[link]]</code></td><td>Wikilink</td></tr>
        </tbody>
      </table>

      <h3>Slash Commands</h3>
      <p>
        Type <code>/</code> at the start of a line to open the slash menu. Insert
        headings, lists, code blocks, tables, math, callouts, images, and more.
      </p>

      <h3>Tables</h3>
      <p>
        Insert a table via <kbd>Cmd+T</kbd> or the slash menu. Use{" "}
        <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> to navigate cells.{" "}
        <kbd>Cmd+Enter</kbd> adds a row. Right-click for column/row operations.
      </p>

      <h3>AI Features</h3>
      <p>
        Press <kbd>Cmd+J</kbd> for inline AI editing. Open the AI Chat panel
        with <kbd>Cmd+Shift+A</kbd>. Use <code>@current</code> in chat to
        reference the active file.
      </p>

      <h3>Wikilinks &amp; Backlinks</h3>
      <p>
        Type <code>[[</code> to create a wikilink. <kbd>Cmd+Click</kbd> to
        navigate. View backlinks in the sidebar (<kbd>Cmd+Shift+B</kbd>).
      </p>

      <h3>Source Mode</h3>
      <p>
        Toggle between WYSIWYG and source code mode with <kbd>Cmd+/</kbd>.
      </p>
    </div>
  );
}

function ShortcutsContent() {
  return (
    <div className="help-content-section">
      <h2>Keyboard Shortcuts</h2>

      <h3>File</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+N</kbd></td><td>New file</td></tr>
          <tr><td><kbd>Cmd+O</kbd></td><td>Open file</td></tr>
          <tr><td><kbd>Cmd+S</kbd></td><td>Save</td></tr>
          <tr><td><kbd>Cmd+Shift+S</kbd></td><td>Save as</td></tr>
          <tr><td><kbd>Cmd+W</kbd></td><td>Close tab</td></tr>
        </tbody>
      </table>

      <h3>Editing</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+B</kbd></td><td>Bold</td></tr>
          <tr><td><kbd>Cmd+I</kbd></td><td>Italic</td></tr>
          <tr><td><kbd>Cmd+E</kbd></td><td>Code</td></tr>
          <tr><td><kbd>Cmd+Shift+X</kbd></td><td>Strikethrough</td></tr>
          <tr><td><kbd>Cmd+Z</kbd></td><td>Undo</td></tr>
          <tr><td><kbd>Cmd+Shift+Z</kbd></td><td>Redo</td></tr>
        </tbody>
      </table>

      <h3>Navigation</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+K</kbd></td><td>Quick switcher</td></tr>
          <tr><td><kbd>Cmd+P</kbd></td><td>Command palette</td></tr>
          <tr><td><kbd>Cmd+Shift+P</kbd></td><td>Command palette</td></tr>
          <tr><td><kbd>Cmd+F</kbd></td><td>Find</td></tr>
          <tr><td><kbd>Cmd+H</kbd></td><td>Find &amp; Replace</td></tr>
        </tbody>
      </table>

      <h3>View</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+/</kbd></td><td>Toggle source mode</td></tr>
          <tr><td><kbd>Cmd+Shift+L</kbd></td><td>Toggle sidebar</td></tr>
          <tr><td><kbd>Cmd+Shift+B</kbd></td><td>Backlinks panel</td></tr>
          <tr><td><kbd>Cmd+,</kbd></td><td>Settings</td></tr>
        </tbody>
      </table>

      <h3>Table</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+T</kbd></td><td>Insert table</td></tr>
          <tr><td><kbd>Tab</kbd></td><td>Next cell</td></tr>
          <tr><td><kbd>Shift+Tab</kbd></td><td>Previous cell</td></tr>
          <tr><td><kbd>Cmd+Enter</kbd></td><td>Add row after</td></tr>
        </tbody>
      </table>

      <h3>AI</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+J</kbd></td><td>Inline AI edit</td></tr>
          <tr><td><kbd>Cmd+Shift+A</kbd></td><td>AI Chat panel</td></tr>
          <tr><td><kbd>Cmd+Shift+T</kbd></td><td>Skill test</td></tr>
        </tbody>
      </table>

      <h3>Bookmarks</h3>
      <table>
        <tbody>
          <tr><td><kbd>Cmd+D</kbd></td><td>Bookmark current file</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function FAQContent() {
  return (
    <div className="help-content-section">
      <h2>Frequently Asked Questions</h2>

      <h3>Where are my files stored?</h3>
      <p>
        Baram works with standard <code>.md</code> files on your local filesystem.
        Open a folder to use it as your workspace — files are never uploaded
        unless you explicitly use an AI feature with a cloud provider.
      </p>

      <h3>How do I use AI features?</h3>
      <p>
        Go to <strong>Settings &gt; AI</strong> and configure your preferred
        provider (Claude, OpenAI, or Ollama for local inference). Set your API
        key and model, then use <kbd>Cmd+J</kbd> for inline editing or{" "}
        <kbd>Cmd+Shift+A</kbd> for the AI chat panel.
      </p>

      <h3>What is Privacy Mode?</h3>
      <p>
        When Privacy Mode is enabled in Settings, only local LLM providers
        (Ollama) are allowed. No data is sent to external APIs.
      </p>

      <h3>Can I use Baram offline?</h3>
      <p>
        Yes. All editing, file management, and search features work offline.
        AI features require either an internet connection (for cloud providers)
        or a local Ollama installation.
      </p>

      <h3>How do wikilinks work?</h3>
      <p>
        Type <code>[[filename]]</code> to create a link to another file in your
        workspace. <kbd>Cmd+Click</kbd> navigates to the target. The Backlinks
        panel shows all files linking to the current document.
      </p>

      <h3>How do I export my document?</h3>
      <p>
        Use the Command Palette (<kbd>Cmd+P</kbd>) and search for
        &quot;Export&quot;. You can export to HTML or PDF.
      </p>

      <h3>How do I customize the theme?</h3>
      <p>
        Open Settings (<kbd>Cmd+,</kbd>) and choose between Light and Dark
        themes in the Appearance tab.
      </p>

      <h3>What math syntax is supported?</h3>
      <p>
        Baram uses KaTeX for math rendering. Inline math: <code>$...$</code>.
        Block math: <code>$$...$$</code>. Full LaTeX math syntax is supported.
      </p>
    </div>
  );
}

export function HelpPanel() {
  const { rightPanelOpen, rightPanelMode } = useUIStore();
  const [activeTab, setActiveTab] = useState<HelpTab>("guide");

  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<HelpTab>).detail;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("help-tab", handler);
    return () => window.removeEventListener("help-tab", handler);
  }, []);

  if (!rightPanelOpen || rightPanelMode !== "help") return null;

  return (
    <div className="help-panel">
      <div className="help-panel-header">
        <div className="help-panel-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`help-tab ${activeTab === tab.id ? "help-tab-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="help-panel-content">
        {activeTab === "guide" && <UserGuideContent />}
        {activeTab === "shortcuts" && <ShortcutsContent />}
        {activeTab === "faq" && <FAQContent />}
      </div>
    </div>
  );
}
