import React from "react";
import ReactDOM from "react-dom/client";

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
 * the graph before this line is reached. Nothing here may touch a persisted store.
 *
 * Failure is non-fatal — a user with nothing to migrate is the common case, and refusing
 * to start the editor over a housekeeping step would be worse than the stale copy.
 */
async function bootstrap(): Promise<void> {
  try {
    await migrateFromLocalStorage();
  } catch (e) {
    console.warn("[bootstrap] localStorage migration failed", e);
  }

  await import("./spaces");
  const { default: App } = await import("./App");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
