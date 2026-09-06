---
title: "Images and videos"
---

## Images

Insert images in multiple ways:

1. **Drag and drop** an image file into the editor
2. **Paste** an image from your clipboard (`Cmd+V`)
3. Type markdown syntax: `![alt text](image-url)`
4. Use the slash command `/image`

Hover over an image to access the toolbar for resizing (25% / 50% / 75% / 100%) and editing alt text.

**Previews and the original.** In the document, images are drawn from a cached preview (up to 2048px on the long edge) rather than the file itself, so a page of camera-sized photos opens without stalling. Click the **View original** button (⤢) in the hover toolbar — or press `Esc` to leave it — to see the full-resolution file. Your markdown is untouched either way: the path you wrote is what stays in the file and what gets exported.

## Videos

Embed videos with the same syntax as images:

1. **Local files** — `![caption](assets/clip.mp4)`. Drag and drop a video file and it is
   copied into an `assets/` folder next to your document.
2. **Direct links** — `![](https://example.com/clip.mp4)`
3. **YouTube / Vimeo** — `![](https://youtu.be/VIDEO_ID)`

Local and remote video files get native playback controls from the moment they render —
there is no separate poster frame or play button to click first. YouTube and Vimeo embeds
load their player the same way, as soon as the document opens, so the provider is contacted
at that moment. Turn off **Settings → Editor → Load video embeds automatically** and an
embed shows a card naming the host instead, with nothing downloaded from YouTube or Vimeo
until you click it to load the player. A direct remote video URL doesn't fetch anything
from its host either until you press play — opening the document alone does not reach out
to it. Local and remote
video files can be resized by dragging their edges, which is stored as
`<video src="…" width="60%"></video>`. Provider embeds are always full width at a 16:9 ratio.

`.mp4` (H.264) plays on every platform. `.webm`, `.mov`, and `.ogv` depend on the
platform's media support — if a video cannot play, the editor says so instead of showing a
blank frame. `.mkv` is not a recognized video container on any platform, so Baram does not
treat it as a video at all — it falls back to an image reference that will not display.
Convert to `.mp4` instead.

When you export to HTML, a local video keeps the same relative path it has in your document
— `assets/clip.mp4` stays `assets/clip.mp4` — rather than being embedded. That means the
`assets` folder (or wherever the video lives, for a nested path) has to sit next to the
exported HTML file in that same relative position, or the video won't play. A video
referenced by an absolute path outside the document's own directory keeps that absolute path
in the export, so it will only play on the machine it was exported from.
