// IA 트리 — 사이드바 순서 · 그룹 라벨 · 페이지 제목의 canonical.
// 문서: dev/design/specs/0045-docs-site-ia-tree.md
//
// ‼️ **이주는 끝났다.** `items`/`h2`/`src`/`wholeDoc` 필드는 원문 `docs/*.md` 의 어느 절이
//    어느 페이지로 갔는지를 남긴 **이력**이고, 그 원문은 이주 커밋에서 삭제됐다. 런타임이
//    읽는 것은 `slug`(사이드바 순서) · `TITLES` · `GROUPS` 뿐이다.
//    손실 없음은 그 커밋의 `check-roundtrip.mjs` 가 바이트 동일성으로 증명했다 —
//    지금은 `check-pages.mjs` 가 "매니페스트 ↔ 디스크" 를 본다.
//
// 배정 문법:
//   {h2:"Name"}        H2 도입부 (H2 줄 ~ 첫 H3). H3를 가진 H2는 이 줄들도 배정해야 한다
//   "Parent > Child"   한정 H3 — 동명 절이 여럿일 때 필수 (Setup ×3, Settings ×2 …)
//   "Child"            비한정 H3 또는 H3 없는 H2. 유일해야 하며 아니면 [모호]로 걸린다
export const UG = "docs/user-guide.md";
export const PD = "docs/plugin-development.md";
export const FAQ = "docs/faq.md";
export const KS = "docs/keyboard-shortcuts.md";

/**
 * 첫 H2 앞의 **파일 머리말**(H1 + 도입부). 어떤 H2/H3 단위에도 속하지 않으므로 여기서
 * 명시적으로 배정하거나 버린다.
 *
 * ‼️ 초기 게이트는 이걸 못 봤다. 배정 대조를 단위 위에서만 했기 때문에 20줄이 아무 페이지에도
 *    없는데 "소진 ✅" 가 나왔다. 이제 `파일 전체 = 단위 + 머리말` 도 함께 단정한다.
 */
export const PREAMBLES = [
  // H1 "Baram User Guide" + 환영 문구. 문서 홈의 도입부가 된다.
  { src: UG, to: "index" },
  // H1 "Frequently Asked Questions" + 구분선뿐 — 제목은 FAQ 그룹 라벨이 대신한다.
  { src: FAQ, drop: true, why: "H1 과 구분선만 있고 본문이 없다" },
  // H1 "Baram Plugin Development Guide" + 빈 줄뿐.
  { src: PD, drop: true, why: "H1 과 빈 줄만 있고 본문이 없다" },
  // 단축키는 문서 통째로 한 페이지이므로 머리말도 그 페이지가 가져간다
  // (Platform Note 는 버릴 수 없는 본문이다).
  { src: KS, to: "customization/keyboard-shortcuts" },
];

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
  // ‼️ ko 라벨은 용어 사전(glossary.json)을 따른다 — `작업 공간` 은 `Workspace` 의
  //    금지 변형이고(canonical `워크스페이스`), `Vault` 는 requireKo 라 영어형을
  //    남길 수 없다. 이 라벨은 페이지 밖이라 오래 검사 밖에 있었고 실제로 둘 다
  //    위반했다 — 지금은 check-glossary.mjs 가 GROUPS 의 ko 라벨도 스캔한다.
  workspace: { en: "Vaults & workspace", ko: "볼트와 워크스페이스" },
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


/**
 * 페이지 제목 (en). Starlight `docsSchema` 가 `title` 프론트매터를 요구하므로 필수다.
 * PAGES 항목마다 인라인으로 두지 않는 이유는 배정(무엇을 가져가나)과 표현(어떻게 부르나)이
 * 다른 관심사이고, 로케일이 늘면 이 표만 늘어나기 때문이다.
 * ‼️ slug 하나라도 빠지거나 남으면 `check-ia.mjs` 가 실패시킨다.
 */
export const TITLES = {
  "index": "Documentation",
  "getting-started": "Getting started",
  "editing/files-and-tabs": "Files, tabs, and saving",
  "editing/formatting": "Formatting text and blocks",
  "editing/slash-commands-and-toolbars": "Slash commands and toolbars",
  "editing/source-mode-and-find": "Source mode, find and replace",
  "rich-content/callouts-and-toggles": "Callouts and toggles",
  "rich-content/math-code-diagrams": "Math, code, and diagrams",
  "rich-content/tables": "Tables and table of contents",
  "rich-content/images-and-videos": "Images and videos",
  "rich-content/footnotes-and-frontmatter": "Footnotes and frontmatter",
  "rich-content/query-blocks": "Query blocks",
  "linking/wikilinks-and-tags": "Wikilinks and tags",
  "linking/dates-references-and-navigation": "Dates, block references, and navigation",
  "workspace/vaults-and-approval": "Vaults and folder access",
  "workspace/external-files-and-perspectives": "External files and perspectives",
  "tasks/anatomy-and-typing": "Writing a task",
  "tasks/repeat-and-time-tracking": "Repeat rules and time tracking",
  "tasks/panel-and-queries": "The Tasks panel and task queries",
  "pdf/toolbar-zoom-and-find": "Reading a PDF",
  "pdf/highlights-and-citing": "Highlighting and citing",
  "pdf/managing-highlights": "Managing highlights",
  "ai/setup-inline-and-ghost-text": "Setup, inline edits, and Ghost Text",
  "ai/contextual-actions-and-chat": "Contextual actions and AI chat",
  "ai/templates-commands-and-skills": "Templates, commands, and Skills",
  "journal/daily-notes": "Journal and daily notes",
  "journal/zettelkasten": "Zettelkasten notes",
  "versioning/git": "Git integration",
  "versioning/file-snapshots": "Version history",
  "export": "Export",
  "customization/settings-and-themes": "Settings and themes",
  "customization/palette-language-and-vim": "Command palette, language, and Vim mode",
  "customization/keyboard-shortcuts": "Keyboard shortcuts",
  "plugins": "Using plugins",
  "plugin-dev/overview-and-capabilities": "Overview and capabilities",
  "plugin-dev/quick-start": "Quick start",
  "plugin-dev/manifest": "The plugin manifest",
  "plugin-dev/entry-point-and-types": "Entry point and public types",
  "plugin-dev/context-commands-editor-files-events": "Context: commands, editor, files, events",
  "plugin-dev/context-ui-and-shadow-dom": "Context: UI and Shadow-DOM isolation",
  "plugin-dev/context-ai-network-storage-settings": "Context: AI, network, storage, settings",
  "plugin-dev/commands-and-tiptap-extensions": "Command palette and Tiptap extensions",
  "plugin-dev/local-development-and-bundling": "Local development and bundling",
  "plugin-dev/registry-json-shape": "The registry JSON shape",
  "plugin-dev/registry-loading-and-testing": "Registry loading and local testing",
  "plugin-dev/publishing": "Publishing a plugin",
  "plugin-dev/trust-model-and-errors": "Trust model, security, and errors",
  "faq/general": "General and language",
  "faq/editing": "Editing",
  "faq/tasks-and-queries": "Tasks and query blocks",
  "faq/linking": "Linking and navigation",
  "faq/pdf": "PDF reading and highlights",
  "faq/ai": "AI",
  "faq/appearance-and-workspace": "Appearance and workspace",
  "faq/journal-and-zettel": "Journal and Zettelkasten",
  "faq/versioning-and-export": "Versioning and export",
  "faq/plugins-and-troubleshooting": "Plugins and troubleshooting",
};

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
