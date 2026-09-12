# Release notes

One file per release, named exactly after its tag: `vX.Y.Z.md`. The file holds the
release body as markdown, with no front matter and no title line — GitHub renders it
under the release's own heading.

## Why they live here and not in the release afterwards

`release.yml` hands this file to `tauri-action` as `releaseBody`, and `tauri-action`
bakes that same text into `latest.json`'s `notes` field. That field is the **only**
thing the in-app update dialog shows, and the dialog has no link out to the release
page — so whatever is in it at build time is the entire answer a user gets to "what
am I about to install?".

Up to and including v0.7.2 this was a placeholder string, and every release was
followed by a hand patch: download `latest.json`, replace one field, verify the
thirteen platform signatures were byte-identical, delete the asset and re-upload it.
Writing the notes **before** the tag removes that step and makes the release body and
the update dialog two readings of one tracked file.

## So: write the notes in the release PR

`verify-tag` fails the release if `.github/release-notes/<tag>.md` is missing or
empty, before any build minutes are spent. That is deliberate — a release with no
notes is not a release anyone can evaluate.

The version bump and the notes belong in the same PR, so both get reviewed before the
tag exists.
