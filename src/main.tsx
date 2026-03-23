import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { markAppStart } from "./utils/perf";

// §8.4 Record app start time for performance measurement
markAppStart();

// Prevent WKWebView crash from Tauri event listener cleanup race conditions.
// These errors are harmless (stale listener access during rapid context switch)
// but unhandled rejections can crash the WebView process on macOS.
window.addEventListener("unhandledrejection", (event) => {
  const msg = String(event.reason?.message ?? event.reason ?? "");
  if (msg.includes("listeners[eventId]") || msg.includes("is not an object")) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
