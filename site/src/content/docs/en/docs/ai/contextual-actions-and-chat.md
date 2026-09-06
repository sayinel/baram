---
title: "Contextual actions and AI chat"
---

## Contextual AI Actions (✨ Sparkles Button)

AI actions adapt to the content you're working with. Look for the ✨ button:

### Floating Toolbar (Text Selection)

Select text and click the ✨ button in the floating toolbar to see actions tailored to your content type:

| Content Type  | Available Actions                                                   |
| ------------- | ------------------------------------------------------------------- |
| **Text**      | Improve, Shorten, Expand, Translate, Tone Change, Explain           |
| **Code**      | Add Comments, Optimize, Find Bugs, Convert Language, Generate Tests |
| **Math**      | Show Steps, Fix LaTeX, Explain, Related Formulas                    |
| **Table**     | Analyze Data, Fill Cells, Suggest Rows, To CSV                      |
| **Structure** | Generate TOC, Improve Structure, Split Sections, Summarize          |

### Block Handle (⋮ Menu)

Hover near the left edge of any block to reveal the ⋮ handle. Click it, then hover over the ✨ item to access block-level AI actions. Actions match the block's content type automatically.

### NodeView AI Buttons

Hover over specialized blocks to reveal a ✨ button directly on the block:

- **Code Block** — Add Comments, Optimize, Find Bugs, Convert, Generate Tests
- **Math Block** — Show Steps, Fix LaTeX, Explain, Related Formulas
- **Table** — Analyze Data, Fill Cells, Suggest Rows, To CSV
- **Image** — Generate Alt Text, Generate Caption, Describe
- **Mermaid Diagram** — Improve Diagram, Explain, Suggest Nodes, Change Style, Convert Type
- **Callout** — Improve, Shorten, Expand, Translate

## AI Chat Panel

Press `Cmd+Shift+A` (macOS) or `Ctrl+Shift+A` (Windows/Linux) to open the AI Chat Panel.

Chat with AI about your documents using **@references** for context:

| Reference    | Description                           |
| ------------ | ------------------------------------- |
| `@selection` | Currently selected text in the editor |
| `@current`   | Full content of the current file      |
| `@file`      | Content of any file in your workspace |
| `@clipboard` | Current clipboard contents            |

The chat panel supports streaming responses with markdown rendering. Use **Apply to Editor** to insert AI responses directly into the editor as formatted WYSIWYG content.
