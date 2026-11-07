// §3.5 The version a file viewer keys its reload and its caches on (#798).
//
// The PDF, HTML and plugin viewers reload when this changes, and the PDF document cache
// (`pdf-doc-cache.ts`), which outlives a tab, keeps documents by (path, version). The HTML
// preview and plugin viewer URLs carry it as `?v=` so the webview fetches again.
//
// It used to be the time of the file's last save. That record is released with the last tab that
// shows the file, so a reopened file started again from no version — and handed a viewer the
// document an earlier tab had cached under that same key, even after the file changed while it was
// closed (the watcher no longer reads a closed file). A version therefore has to be a value no
// earlier version of the session had, not a time that can come round again.
let last = 0;

/**
 * A viewer version greater than every one handed out before in this session. It starts from the
 * clock, so a later session does not hand out an earlier session's values either while the clock
 * moves forward, and counts up by one where the clock has not moved on.
 */
export function nextViewerVersion(): number {
  last = Math.max(Date.now(), last + 1);
  return last;
}
