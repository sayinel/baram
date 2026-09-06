---
title: "Managing highlights"
---

## Deleting, restoring, and purging

Deleting a highlight is a **soft delete**. The entry stays in place with a deletion timestamp, the
overlay stops being drawn, and it moves to the **Deleted** sub-tab of the Highlights panel.

This is deliberate. The quoted text lives in the companion note and the geometry lives in the
sidecar; discarding the entry outright would strip every reference pointing at it back to a bare
80-character label, and an area reference would lose its crop rectangle and become
**unrecoverable**. Soft deletion keeps both kinds of reference whole.

From the Deleted tab you can:

- **Restore** — the highlight comes back exactly as it was, references included
- **Delete permanently** — the entry is removed for good. Baram counts how many references point
  at it first and says so in the confirmation, because those references will lose their preview.
  The quoted text stays in the companion note either way.

## Where highlights are stored

Nothing is hidden in a database, and nothing is written into the PDF:

| File | Contents |
| ---- | -------- |
| `highlights/<path-to-pdf>.md` | A companion markdown note holding the quoted text of each highlight, one block-ID'd paragraph per highlight |
| `.baram/pdf-highlights/<path-to-pdf>.json` | The geometry — page number, rectangles, colour, kind, and deletion state |

Both are plain text inside your vault, so they diff, merge, and sync like everything else. The
companion note is an ordinary markdown file: you can open it, read the highlights as a reading
list, and write around them.

A malformed entry in the sidecar is dropped on its own rather than taking the whole file with it,
so one bad record cannot cost you every highlight in a document.

## Linking to PDFs

PDFs are ordinary link targets. `[[paper.pdf]]` resolves and opens in the reader, the wikilink
autocomplete offers viewable files and labels their type, and a plain markdown link —
`[see the paper](papers/attention.pdf)` — opens in the app rather than handing off to the OS.
Because these are indexed as real edges, PDFs show up in backlinks and in the graph.

---
