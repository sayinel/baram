import React from "react";
import ReactDOM from "react-dom/client";

// §260 Phase 5 re-review (R3) — the stylesheet lives HERE, not in `App.tsx`.
//
// `App` is dynamically imported below, so a stylesheet imported from it is bound to that
// chunk and its `<link>` is injected at runtime: `dist/index.html` ended up with no
// `<link rel="stylesheet">` at all, and 320 KB of CSS could not start loading until the
// migration's IPC round trips and both dynamic imports had resolved. That is a blank,
// unstyled window on every cold start and a §8.4 regression. Imported from the entry
// module, it is back in `index.html`'s `<head>` and fetches in parallel with everything
// else. CSS touches no store, so the ordering guarantee below is unaffected.
import "./styles/index.css";
import { migrateFromLocalStorage } from "./stores/system/tauri-storage";
import { markAppStart } from "./utils/perf";

// §8.4 Record app start time for performance measurement
markAppStart();

// Prevent WKWebView crash from unhandled promise rejections.
// On macOS WKWebView, unhandled rejections (e.g., Tauri event listener
// cleanup race, stale IPC calls) can crash the entire WebView process,
// causing the app to reload and lose all editor state.
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();

  console.warn("[Suppressed unhandled rejection]", event.reason);
});

// Also catch synchronous uncaught errors that could crash the WebView.
window.addEventListener("error", (event) => {
  const msg = String(event.message ?? "");
  // Suppress errors from Tauri internals / chunk loading during WebView transitions
  if (
    msg.includes("Can't find variable: document") ||
    msg.includes("listeners[")
  ) {
    event.preventDefault();

    console.warn("[Suppressed error]", event.message);
  }
});

/**
 * §260 Phase 5 code review (H1) — the localStorage sweep runs BEFORE the app's module
 * graph is imported, and is awaited.
 *
 * It used to be a `useEffect` in `use-app-startup`, which is wrong twice over. React runs
 * CHILD effects before parent ones, so `BookmarkPanel`'s load-then-autosave pair ran
 * first: the load found nothing in config, the autosave correctly wrote `"[]"`, and the
 * sweep then saw a truthy `"[]"`, concluded "already migrated" and skipped — losing the
 * user's bookmarks on upgrade and leaving the readable copy in place. And a store that
 * rehydrates at module-eval time (`journal-layout`) had already started reading before any
 * effect could run at all.
 *
 * Hence the dynamic imports: a static `import App` would evaluate every store module in
 * the graph before this line is reached. Nothing above the imports may touch a persisted
 * store.
 *
 * A failed MIGRATION is non-fatal — a user with nothing to migrate is the common case, and
 * refusing to start the editor over a housekeeping step would be worse than a stale copy.
 * A failed IMPORT is fatal, and must say so (§260 Phase 5 re-review, R4): the dynamic
 * imports used to sit outside the try with `void bootstrap()` discarding the rejection,
 * which the `unhandledrejection` handler above then swallowed into a `console.warn` — so a
 * chunk-load failure, the exact thing the handler below anticipates, produced a blank white
 * window with no message and no way to know why.
 */
async function bootstrap(): Promise<void> {
  try {
    await migrateFromLocalStorage();
  } catch (e) {
    console.warn("[bootstrap] localStorage migration failed", e);
  }

  try {
    await import("./spaces");
    const { default: App } = await import("./App");

    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  } catch (e) {
    console.error("[bootstrap] failed to start the app", e);
    showFatalError(e);
  }
}

/**
 * Last resort when the app could not be loaded at all: plain DOM, no React, no imports —
 * whatever failed may be the reason none of those are available.
 */
function showFatalError(cause: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const detail = cause instanceof Error ? cause.message : String(cause);
  root.textContent = "";

  const box = document.createElement("div");
  box.setAttribute(
    "style",
    "font:14px/1.6 system-ui,sans-serif;padding:32px;max-width:44em;margin:0 auto",
  );
  const heading = document.createElement("p");
  heading.textContent = "Baram could not start.";
  heading.setAttribute("style", "font-weight:600;margin:0 0 8px");
  const advice = document.createElement("p");
  advice.textContent =
    "Restarting usually fixes this. If it does not, reinstall.";
  advice.setAttribute("style", "margin:0 0 12px");
  const why = document.createElement("pre");
  // textContent, not innerHTML — the message can carry a path or a URL.
  why.textContent = detail;
  why.setAttribute("style", "white-space:pre-wrap;opacity:.7;margin:0");

  box.append(heading, advice, why);
  root.append(box);
}

void bootstrap();
