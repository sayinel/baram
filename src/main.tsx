import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { markAppStart } from "./utils/perf";

// §8.4 Record app start time for performance measurement
markAppStart();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
