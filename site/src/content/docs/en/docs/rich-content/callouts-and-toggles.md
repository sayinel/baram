---
title: "Callouts and toggles"
---


## Callout Blocks

Callout blocks provide highlighted admonitions compatible with Obsidian syntax:

```markdown
> [!info] Title
> Content goes here.
```

**Supported types:** `info`, `tip`, `warning`, `danger`, `note`, `abstract`, `todo`, `success`, `question`, `failure`, `example`, `quote`

Each type has a distinct color and icon. Add a `-` after the type to make it collapsible:

```markdown
> [!warning]- Click to expand
> This content is hidden by default.
```

Create a callout via the slash command `/callout` or by typing `> [!` at the start of a line.

## Toggle Blocks

Toggle blocks create collapsible sections using HTML `<details>` syntax:

```markdown
<details>
<summary>Click to expand</summary>

Hidden content here. Supports any block type — paragraphs, lists, code blocks, etc.

</details>
```

**Features:**

- **Collapse/expand** — Click the triangle indicator or press `Cmd+Enter`
- **Toggle Heading** — Use a heading as the summary for collapsible heading sections:
  ```markdown
  <details>
  <summary>## Section Title</summary>

  Section content that can be collapsed.

  </details>
  ```
- **Nested toggles** — Place toggles inside toggles for hierarchical collapsible content
- Create via slash commands: `/toggle`, `/toggle heading 1`, `/toggle heading 2`, `/toggle heading 3`
