---
title: "Highlighting and citing"
---

## Creating a highlight

**Text highlights** — Turn on *Text highlight mode*, then select text. A popup appears with five
colours (yellow, green, blue, pink, purple); pick one and the highlight is written.

**Area highlights** — Turn on *Area highlight mode* and drag a rectangle, or hold **Alt** and drag
anywhere without switching modes. Press `Escape` mid-drag to cancel. Use these for figures,
tables, screenshots, and typeset equations — anything whose meaning is not in the text layer.

Clicking an existing highlight reopens the popup, where you can recolour it, copy from it, or
delete it. Where two highlights overlap, the click resolves to the topmost one.

## Referencing a highlight from your notes

This is the point of the feature: a highlight is not just a mark on a PDF, it is a block you can
cite.

1. Click a highlight and choose **Copy reference**
2. Paste into any markdown file

The pasted text is a block reference — `((highlights/papers/attention#^a1b2c3|Attention is all you need))`
— pointing at the companion note, with a short label after the `|`. It renders inline as a preview
of what you highlighted, not as that label:

- A **text** highlight renders the full quoted sentence, not a truncated label
- An **area** highlight renders the cropped region of the PDF as an image

`Cmd+click` a reference to open the PDF at that highlight.

**Copy text** is also on the popup for text highlights, when you want the raw quoted text and
no link. Area highlights do not offer it — there is no text behind a region to copy.

### Resizing an area reference

An area reference renders at a percentage of the available width. Drag its right edge to resize
it, or write the width by hand:

```markdown
((highlights/papers/attention#^a1b2c3|Figure 2|w=60))
```

`w=` goes last and takes an integer percentage from **10 to 100**. The label before it is
optional — `((target#^id|w=60))` is equally valid. It is part of the markdown, so the width
survives a round-trip and travels with the file — and it is visible in the source, not hidden in
a metadata store.
