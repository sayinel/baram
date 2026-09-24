---
title: "Symbols, emoji, and smart punctuation"
---

Three ways to type characters that are not on the keyboard: a `:` suggestion while you type, a picker you can browse, and smart punctuation that turns `->` into `→` for you.

All three write the character itself into the file. A `:smile` you pick becomes `😄` in the markdown, not a `:smile:` shortcode, so the file stays standard markdown that any editor reads the same way.

## Type `:` to insert a symbol or emoji

Type `:` and at least two characters of a name. A menu of matching symbols and emoji opens next to the caret.

| You type  | You get            |
| --------- | ------------------ |
| `:arrow`  | `→` and other arrows |
| `:smile`  | `😄` and other smiling faces |
| `:heart`  | `❤️`                |
| `:+1`     | `👍️`                |
| `:화살표` | `→` — Korean keywords work too |
| `:웃음`   | `😀` and other smiling faces |

The character shown is the first match, the one **Enter** inserts; the menu lists the eight best matches.

- **↑ / ↓** move through the menu, **Enter** or **Tab** inserts the highlighted item, and a click inserts the one you click
- **Esc** closes the menu and leaves what you typed. In Vim insert mode the first **Esc** closes the menu and the second one returns to normal mode
- Keep typing to narrow the list. A space ends the search

The `:` has to start a word — at the start of a line or after a space. A colon inside a word or number is left alone, so `10:30`, `https://` and `key: value` never open the menu. It also stays closed in code blocks, in inline code (including after a backtick you have not closed yet), and while you are editing an inline math formula.

Emoji come with one appearance each; skin-tone variants are not offered.

To turn the suggestions off, go to **Settings > Markdown**, the **Typography** heading, and switch off **Symbol & Emoji Suggestions**. It is on by default.

## Browse the symbol and emoji picker

When you do not know a symbol's name, open the picker from the slash menu: type `/` and choose **Symbols & Emoji** (typing `/sym` or `/emoji` finds it). The picker opens at the caret, with the search box focused.

- **Search** — type an English or Korean keyword to search all symbols and emoji at once; the results replace the sections until you clear the box
- **Tabs** — jump to a section: Recently used, Symbols (arrows, math, currency, punctuation, marks and shapes, other symbols), and the emoji groups from Smileys & emotion to Flags
- **Arrow keys** move through the grid, **Enter** inserts the highlighted character, and a click inserts the one you click. The name of the highlighted character is shown at the bottom
- **Esc**, or a click outside the picker, closes it without inserting anything. The caret goes back to where it was

### Recently used

The **Recently used** tab keeps up to 24 characters you inserted most recently, newest first. The picker and the `:` menu both count — a pick from the `:` menu shows up here too. Smart punctuation replacements are not recorded. The list is kept when you restart Baram.

## Smart punctuation

Smart punctuation replaces a typed sequence with the symbol it stands for. It is **off by default** — turn it on in **Settings > Markdown**, under **Typography**, with **Smart Punctuation**.

| You type | You get | Note |
| -------- | ------- | ---- |
| `->`     | `→`     | |
| `<-`     | `←`     | |
| `<->`    | `↔`     | |
| `=>`     | `⇒`     | |
| `<=`     | `≤`     | |
| `<=>`    | `⇔`     | |
| `>=`     | `≥`     | |
| `!=`     | `≠`     | |
| `...`    | `…`     | |
| `--`     | `—`     | Replaced when you type the next character, so `a -- b` becomes `a — b` |

**Undo a replacement** — press **Backspace** right after it to get back what you typed. A sequence built from another steps back one stage at a time: after `<->` became `↔`, one **Backspace** gives `←>`.

**What stays as typed:**

- Code blocks, inline code, and text after a backtick you have not closed yet in the same paragraph
- An inline math formula you are editing
- Everything after an opener that is not yet closed earlier in the same paragraph — a wikilink (`[[…`), a link destination (`](…`), a footnote (`[^…`), a block reference (`((…`) or a skill variable (`{{…`) — until its closer (`]]`, `)`, `]`, `))`, `}}`) appears. `[[a->b` stays `[[a->b` until you close it, so the link keeps its target
- An HTML comment you are typing (`<!-- …`), a word containing `://` (a URL), and a `#tag` you are typing
- Three dashes (`---`, a horizontal rule), a table delimiter row written without spaces (`|--|`), `-->`, and a `--` at the very start of a paragraph
- Anything you paste — only typing is converted
- Skill files — files whose frontmatter has both `name:` and `description:` (see [Skills](/en/docs/ai/templates-commands-and-skills/#skills)), where `->` often means a step, not an arrow

**One thing to watch:** a command-line flag written in prose, like `--flag`, becomes `—flag`. Type it inside backticks (`` `--flag` ``) and it stays as written.
