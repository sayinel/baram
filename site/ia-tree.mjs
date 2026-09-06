// IA 트리 기계 판독본. dev/design/specs/2026-09-06-docs-site-ia-tree.md 와 짝이다.
//
// 배정 문법:
//   {h2:"Name"}        H2 도입부 (H2 줄 ~ 첫 H3). H3를 가진 H2는 이 줄들도 배정해야 한다
//   "Parent > Child"   한정 H3 — 동명 절이 여럿일 때 필수 (Setup ×3, Settings ×2 …)
//   "Child"            비한정 H3 또는 H3 없는 H2. 유일해야 하며 아니면 [모호]로 걸린다
export const UG = "docs/user-guide.md";
export const PD = "docs/plugin-development.md";
export const FAQ = "docs/faq.md";
export const KS = "docs/keyboard-shortcuts.md";

/** 원문에서 의도적으로 버리는 절 — Starlight이 사이드바·페이지 TOC를 생성하므로 손 목차는 낡을 뿐이다 */
export const DROPPED = [{ src: UG, level: 2, text: "Table of Contents" }];
/**
 * 사이드바 그룹 — 키는 **slug 접두어**다. `editing/files-and-tabs` → `editing`.
 * 그래서 페이지에 group 필드를 두지 않는다(두면 slug와 갈라진다).
 * 접두어가 없는 slug는 단독 페이지이고 그룹에 속하지 않는다.
 */
export const GROUPS = {
  editing: { en: "Editing", ko: "편집" },
  "rich-content": { en: "Rich content", ko: "리치 콘텐츠" },
  linking: { en: "Linking & navigation", ko: "링크와 탐색" },
  workspace: { en: "Vaults & workspace", ko: "Vault와 작업 공간" },
  tasks: { en: "Tasks", ko: "태스크" },
  pdf: { en: "Reading PDFs", ko: "PDF 읽기" },
  ai: { en: "AI features", ko: "AI 기능" },
  journal: { en: "Journal & Zettelkasten", ko: "저널과 제텔카스텐" },
  versioning: { en: "Git & version history", ko: "Git과 버전 히스토리" },
  customization: { en: "Customization", ko: "사용자 설정" },
  "plugin-dev": { en: "Plugin development", ko: "플러그인 개발" },
  faq: { en: "FAQ", ko: "FAQ" },
};

/** slug 접두어 → 그룹 키. 접두어가 없으면 단독 페이지(null). */
export function groupOf(slug) {
  const prefix = slug.includes("/") ? slug.slice(0, slug.indexOf("/")) : null;
  return prefix && prefix in GROUPS ? prefix : null;
}


export const PAGES = [
  { slug: "index", synthetic: true },

  { slug: "getting-started", src: UG, items: [
    { h2: "Getting Started" },
    "Installation", "First Launch", "Interface Overview", "Help Menu", "Getting Help" ] },

  // ── 편집
  { slug: "editing/files-and-tabs", src: UG, items: [
    { h2: "Writing Documents" },
    "Creating and Opening Files", "Importing files by drag and drop", "Tabs",
    "Quick Switcher", "Auto-Save", "Undo and Redo" ] },
  { slug: "editing/formatting", src: UG, items: [
    { h2: "Formatting" }, "Inline Formatting", "Block Formatting" ] },
  { slug: "editing/slash-commands-and-toolbars", src: UG, items: [
    "Slash Commands", "Floating Toolbar", "Block Handle", "Context Menu" ] },
  { slug: "editing/source-mode-and-find", src: UG, floorException: true, items: [
    "Source Mode", { h2: "Find & Replace" }, "Find (Cmd+F)", "Replace (Cmd+H)" ] },

  // ── 리치 콘텐츠
  { slug: "rich-content/callouts-and-toggles", src: UG, items: [
    { h2: "Rich Content" }, "Callout Blocks", "Toggle Blocks" ] },
  { slug: "rich-content/math-code-diagrams", src: UG, items: [
    "Math (KaTeX)", "Code Blocks (CodeMirror 6)", "Mermaid Diagrams" ] },
  { slug: "rich-content/tables", src: UG, items: [
    "Tables", "Rich Content > Table of Contents" ] },
  { slug: "rich-content/images-and-videos", src: UG, items: [
    "Images", "Videos" ] },
  { slug: "rich-content/footnotes-and-frontmatter", src: UG, items: [
    "Footnotes", "YAML Frontmatter" ] },
  { slug: "rich-content/query-blocks", src: UG, items: [ "Query Blocks" ] },

  // ── 링크와 탐색
  { slug: "linking/wikilinks-and-tags", src: UG, items: [
    { h2: "Linking & Navigation" }, "Wikilinks", "Auto-Rename", "Tags" ] },
  { slug: "linking/dates-references-and-navigation", src: UG, items: [
    "@Dates", "Block References", "Backlinks", "Navigation History", "Bookmarks", "Graph View" ] },

  // ── Vault와 작업 공간
  { slug: "workspace/vaults-and-approval", src: UG, items: [
    { h2: "Vault & Context System" },
    "What is a Vault?", "Context Types", "Opening and Switching Vaults",
    "Journal and Vaults", "Folder Access Approval" ] },
  { slug: "workspace/external-files-and-perspectives", src: UG, items: [
    "Cross-Vault Wikilinks", "Opening External Files", "Viewing Other File Types",
    "Tab Tear-Off (Separate Window)",
    { h2: "Perspectives" },
    "Built-in Perspectives", "Custom Perspectives", "Applying a Perspective" ] },

  // ── 태스크
  { slug: "tasks/anatomy-and-typing", src: UG, items: [
    { h2: "Tasks" }, "Anatomy of a task line", "Typing a task" ] },
  { slug: "tasks/repeat-and-time-tracking", src: UG, items: [
    "Slash commands", "Editing an existing task", "Repeat rules", "Time tracking" ] },
  { slug: "tasks/panel-and-queries", src: UG, items: [
    "The Tasks panel", "Tasks in this note", "Capturing tasks",
    "Tasks in a query block", "Task settings" ] },

  // ── PDF 읽기
  { slug: "pdf/toolbar-zoom-and-find", src: UG, items: [
    { h2: "PDF Reading & Highlights" },
    "The PDF toolbar", "Zoom", "Find in a PDF (Cmd+F)", "The side panel" ] },
  { slug: "pdf/highlights-and-citing", src: UG, items: [
    "Creating a highlight", "Referencing a highlight from your notes" ] },
  { slug: "pdf/managing-highlights", src: UG, items: [
    "Deleting, restoring, and purging", "Where highlights are stored", "Linking to PDFs" ] },

  // ── AI 기능
  { slug: "ai/setup-inline-and-ghost-text", src: UG, items: [
    { h2: "AI Features" },
    "AI Features > Setup", "Privacy Mode",
    "Inline AI Editing (Cmd+J)", "Ghost Text (AI Autocomplete)" ] },
  { slug: "ai/contextual-actions-and-chat", src: UG, items: [
    "Contextual AI Actions (✨ Sparkles Button)", "AI Chat Panel" ] },
  { slug: "ai/templates-commands-and-skills", src: UG, items: [
    "Smart Templates", "Slash AI Commands", "Extract Action Items",
    "Custom AI Commands", "Skills" ] },

  // ── 저널과 제텔카스텐
  { slug: "journal/daily-notes", src: UG, items: [
    { h2: "Journal / Daily Notes" },
    "Journal / Daily Notes > Setup", "Creating Daily Notes", "Templates", "Periodic Notes",
    "Photo Journal", "Memories", "Streaks & Stats", "Journal Themes" ] },
  { slug: "journal/zettelkasten", src: UG, items: [
    { h2: "Zettel (Zettelkasten Notes)" },
    "Zettel (Zettelkasten Notes) > Setup", "The hub panel", "Quick Capture",
    "Where a capture lands", "Hub notes and the Captures section",
    "Promoting to permanent notes", "Linking notes", "Maps of Content (MOC)" ] },

  // ── Git과 버전 히스토리
  { slug: "versioning/git", src: UG, floorException: true, items: [
    { h2: "Git Integration" },
    "Source Control Sidebar", "Diff Viewer", "Branch Management", "History, Stash & Remote" ] },
  { slug: "versioning/file-snapshots", src: UG, items: [
    { h2: "Version History (File Snapshots)" },
    "How It Works", "Version History Sidebar", "Viewing Diffs", "Restoring Files",
    "Creating Manual Snapshots", "Version History (File Snapshots) > Settings",
    "Retention Policy", "Git Users" ] },

  { slug: "export", src: UG, items: [
    { h2: "Export" }, "HTML", "PDF", "Notion", "Pandoc Formats (Word, LaTeX, EPUB, RST)" ] },

  // ── 사용자 설정
  { slug: "customization/settings-and-themes", src: UG, items: [
    { h2: "Customization" }, "Customization > Settings", "Themes" ] },
  { slug: "customization/palette-language-and-vim", src: UG, items: [
    "Command Palette", "Language", "Vim Mode", "Keyboard Shortcuts" ] },
  { slug: "customization/keyboard-shortcuts", src: KS, wholeDoc: true },

  { slug: "plugins", src: UG, items: [
    { h2: "Plugins" },
    "Turning plugins on and off", "Capabilities and trust", "Withdrawn plugins" ] },

  // ── 플러그인 개발
  { slug: "plugin-dev/overview-and-capabilities", src: PD, items: [
    "Overview", "Capabilities" ] },
  { slug: "plugin-dev/quick-start", src: PD, items: [
    { h2: "Quick Start" }, "The sandboxed tier's API differs" ] },
  { slug: "plugin-dev/manifest", src: PD, items: [
    { h2: "Manifest (baram-plugin.json)" },
    "Required Fields", "Optional Fields", "Version floor" ] },
  { slug: "plugin-dev/entry-point-and-types", src: PD, items: [
    "Entry Point", "Using the public types" ] },
  { slug: "plugin-dev/context-commands-editor-files-events", src: PD, items: [
    { h2: "ExtensionContext API" },
    "context.commands (requires commands)", "context.editor (requires editor or editor:readonly)",
    "context.files (requires files or files:readonly)", "context.events (requires events)" ] },
  { slug: "plugin-dev/context-ui-and-shadow-dom", src: PD, items: [
    "context.ui", "Shadow-DOM UI isolation" ] },
  { slug: "plugin-dev/context-ai-network-storage-settings", src: PD, items: [
    "context.ai (requires ai)", "context.network (requires network)",
    "context.storage (requires storage)", "context.settings (requires settings)",
    "context.subscriptions" ] },
  { slug: "plugin-dev/commands-and-tiptap-extensions", src: PD, items: [
    "Command Palette integration", "Tiptap Extension plugins" ] },
  { slug: "plugin-dev/local-development-and-bundling", src: PD, items: [
    "Local development loop", "Bundling" ] },
  { slug: "plugin-dev/registry-json-shape", src: PD, items: [
    { h2: "Publishing to the Registry" }, "The registry JSON shape" ] },
  { slug: "plugin-dev/registry-loading-and-testing", src: PD, items: [
    "How Baram loads the registry", "Local testing" ] },
  { slug: "plugin-dev/publishing", src: PD, items: [
    "The committed seed", "Publishing your own plugin" ] },
  { slug: "plugin-dev/trust-model-and-errors", src: PD, items: [
    "Trust model & security", "Timeouts & error handling" ] },

  // ── FAQ (H2 단위 배정 — 도입부까지 자동 포함)
  { slug: "faq/general", src: FAQ, h2: ["General", "Language"] },
  { slug: "faq/editing", src: FAQ, h2: ["Editing"] },
  { slug: "faq/tasks-and-queries", src: FAQ, h2: ["Tasks", "Query Blocks"] },
  { slug: "faq/linking", src: FAQ, h2: ["Linking & Navigation"] },
  { slug: "faq/pdf", src: FAQ, h2: ["PDF Reading & Highlights"] },
  { slug: "faq/ai", src: FAQ, h2: ["AI"] },
  { slug: "faq/appearance-and-workspace", src: FAQ, h2: [
    "Themes & Appearance", "Keyboard Shortcuts", "Perspectives", "Vault & Context"] },
  { slug: "faq/journal-and-zettel", src: FAQ, h2: [
    "Zettel (Zettelkasten Notes)", "Journal / Daily Notes"] },
  { slug: "faq/versioning-and-export", src: FAQ, h2: [
    "Version History (File Snapshots)", "Git Integration", "Export"] },
  { slug: "faq/plugins-and-troubleshooting", src: FAQ, h2: ["Plugins", "Troubleshooting"] },
];
