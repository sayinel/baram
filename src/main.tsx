import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
