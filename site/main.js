import { MESSAGES } from "./i18n.js";

// --- pure helpers (unit-tested via node:test) ---

export function pickLanguage(stored, navLang) {
  if (stored === "en" || stored === "ko") return stored;
  return (navLang || "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

// --- DOM wiring (browser only) ---

function applyLanguage(lang) {
  const dict = MESSAGES[lang];
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = dict[el.dataset.i18n];
    if (msg) el.textContent = msg;
  }
  const toggle = document.getElementById("lang-toggle");
  if (toggle) toggle.textContent = lang === "en" ? "KO" : "EN";
}

function init() {
  const lang = pickLanguage(localStorage.getItem("baram-lang"), navigator.language);
  applyLanguage(lang);
  document.getElementById("lang-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.lang === "en" ? "ko" : "en";
    localStorage.setItem("baram-lang", next);
    applyLanguage(next);
  });
}

if (typeof document !== "undefined") init();
