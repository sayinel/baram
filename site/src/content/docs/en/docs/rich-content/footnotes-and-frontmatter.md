---
title: "Footnotes and frontmatter"
---

## Footnotes

Add footnote references and definitions using standard markdown syntax.

**Creating a footnote:**

1. Type `[^id]` anywhere in your text (e.g., `[^1]`, `[^note]`)
2. A superscript number appears inline, and a footnote definition block is automatically appended at the end of the document
3. Click the definition area to type the footnote content

**Display:**

- References display as sequential numbers (1, 2, 3…) based on the order they appear in the document, regardless of identifier name
- Definitions display as `N. content ↩` — the number followed by the content and a back-arrow

**Navigation:**

- **Hover** a reference to see a tooltip preview of the definition
- **Click** a reference to scroll to the definition
- **Click** the number or ↩ in the definition to scroll back to the reference

**Example:**

```markdown
Einstein proposed E=mc²[^einstein] which revolutionized physics[^physics].

[^einstein]: Albert Einstein, 1905.
[^physics]: See "On the Electrodynamics of Moving Bodies".
```

In the editor, `[^einstein]` displays as `1` and `[^physics]` as `2`.

**Editing tips:**

- Press **Enter** on an empty last line inside a definition to exit the block
- Press **Backspace** at the start of the first line to lift the content out of the definition

## YAML Frontmatter

YAML frontmatter at the top of a document is automatically detected and rendered as a structured block:

```yaml
---
title: My Document
tags: [baram, markdown]
date: 2026-02-17
---
```

---
