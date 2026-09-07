---
title: "Templates, commands, and Skills"
---

## Smart Templates

Type `/ai-template` in the slash menu to generate structured content from AI-powered templates:

- Choose from template categories (e.g., Meeting Notes, Project Plan, Technical Spec)
- Or write a custom description for any document type
- Generated content is inserted as fully rendered WYSIWYG blocks (headings, lists, tables, etc.)

## Slash AI Commands

Type `/` in the editor to access AI commands:

| Command           | Description                            |
| ----------------- | -------------------------------------- |
| `/ai-write`       | Write or continue from current context |
| `/ai-brainstorm`  | Brainstorm ideas from current context  |
| `/ai-summarize`   | Summarize selected text                |
| `/ai-expand`      | Expand and elaborate on selected text  |
| `/ai-fix-grammar` | Fix grammar and spelling               |
| `/ai-translate`   | Translate to another language          |
| `/ai-explain`     | Explain selected text in simple terms  |
| `/ai-template`    | Generate content from AI templates     |
| `/extract-tasks`  | Pull action items out of the selection |

## Extract Action Items

`/extract-tasks` (**Extract Action Items**) reads the prose you selected — meeting notes, a call summary, a paragraph of decisions — and proposes a list of tasks from it.

1. Select the text (or leave the cursor in the section you want read)
2. Run `/extract-tasks` from the slash menu
3. Review the proposed task lines in the AI diff preview
4. **Accept** to insert them, or **Reject** to discard

Nothing is written to the document until you accept. The extracted lines are ordinary task lines, so date and priority fields can be added afterwards the usual way — see [Tasks](/en/docs/tasks/anatomy-and-typing/).

It needs a configured AI model, and it respects [Privacy Mode](/en/docs/ai/setup-inline-and-ghost-text/#privacy-mode): with privacy on and no local model available, it declines rather than sending your notes to a cloud provider.

## Custom AI Commands

Create your own slash commands in **Settings > AI > Custom Commands**:

- Define a name, description, and prompt template
- Use variable substitution: `{selection}`, `{document}`, `{clipboard}`
- Custom commands appear in the slash menu alongside built-in AI commands

## Skills

Baram includes tools for editing AI prompt files (Skills):

- **Prompt Lint** — 6 static rules check your prompts for common issues (shown as wavy underlines)
- **Skill Templates** — Start from pre-built templates for common prompt patterns
- **Skill Auto-Generation** — Describe what you want and let AI generate the skill file
- **Skill Test** (`Cmd+Shift+T` / `Ctrl+Shift+T`) — Test a skill inline by running it against the AI provider
