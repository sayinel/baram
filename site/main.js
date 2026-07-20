import { MESSAGES } from "./i18n.js";

// --- pure helpers (unit-tested via node:test) ---

export function pickLanguage(stored, navLang) {
  if (stored === "en" || stored === "ko") return stored;
  return (navLang || "").toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function detectOS(platformString) {
  const p = (platformString || "").toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "win";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "unknown";
}

const PRIMARY_ASSET_PATTERNS = {
  mac: [/_universal\.dmg$/, /_aarch64\.dmg$/],
  win: [/_x64-setup\.exe$/, /\.msi$/],
  linux: [/_amd64\.AppImage$/, /_amd64\.deb$/],
};

export function pickPrimaryAsset(assets, os) {
  for (const pattern of PRIMARY_ASSET_PATTERNS[os] || []) {
    const hit = (assets || []).find((a) => pattern.test(a.name));
    if (hit) return hit;
  }
  return null;
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

const OS_LABELS = { mac: "macOS", win: "Windows", linux: "Linux" };

async function initDownload() {
  const os = detectOS(navigator.userAgentData?.platform || navigator.platform);
  const osLabel = document.getElementById("download-os");
  if (osLabel && OS_LABELS[os]) osLabel.textContent = ` · ${OS_LABELS[os]}`;
  try {
    const res = await fetch("https://api.github.com/repos/sayinel/baram/releases/latest");
    if (!res.ok) return; // static fallback links keep working
    const release = await res.json();
    const versionEl = document.getElementById("release-version");
    if (versionEl && release.tag_name) versionEl.textContent = release.tag_name;
    const primary = pickPrimaryAsset(release.assets, os);
    const btn = document.getElementById("download-primary");
    if (btn && primary) btn.href = primary.browser_download_url;
    const list = document.getElementById("asset-list");
    if (list && release.assets?.length) {
      list.textContent = "";
      for (const asset of release.assets) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = asset.browser_download_url;
        link.textContent = asset.name;
        li.appendChild(link);
        list.appendChild(li);
      }
    }
  } catch {
    // network/rate-limit failure: leave static fallback links untouched
  }
}

function init() {
  const lang = pickLanguage(localStorage.getItem("baram-lang"), navigator.language);
  applyLanguage(lang);
  document.getElementById("lang-toggle")?.addEventListener("click", () => {
    const next = document.documentElement.lang === "en" ? "ko" : "en";
    localStorage.setItem("baram-lang", next);
    applyLanguage(next);
  });
  initDownload();
}

if (typeof document !== "undefined") init();
