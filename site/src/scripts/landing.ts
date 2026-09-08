// 랜딩의 클라이언트 로직. 옛 `site/main.js` 에서 이주했다.
// 언어 전환은 여기 없다 — URL 라우팅이 대신한다(옛 localStorage 토글 폐기).

// 별 배지는 문서 헤더와 공유한다 — 두 표면의 개수·폴백이 갈리지 않게 한 모듈에 둔다.
import { initStarBadges } from "./github-stars.ts";

const PRIMARY_ASSET_PATTERNS: Record<string, RegExp[]> = {
  mac: [/_universal\.dmg$/, /_aarch64\.dmg$/],
  win: [/_x64-setup\.exe$/, /\.msi$/],
  linux: [/_amd64\.AppImage$/, /_amd64\.deb$/],
};

const OS_LABELS: Record<string, string> = { mac: "macOS", win: "Windows", linux: "Linux" };

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

// ── 순수 헬퍼 (단위 테스트 대상) ─────────────────────────────────────────

export function detectOS(platformString: string | undefined): string {
  const p = (platformString || "").toLowerCase();
  if (p.includes("mac")) return "mac";
  if (p.includes("win")) return "win";
  if (p.includes("linux") || p.includes("x11")) return "linux";
  return "unknown";
}

export function pickPrimaryAsset(assets: ReleaseAsset[] | undefined, os: string): ReleaseAsset | null {
  for (const pattern of PRIMARY_ASSET_PATTERNS[os] ?? []) {
    const hit = (assets ?? []).find((a) => pattern.test(a.name));
    if (hit) return hit;
  }
  return null;
}

/** `.sig` 와 `latest.json` 은 업데이터 전용이라 사람이 내려받을 것이 아니다. */
export function isDownloadableAsset(name: string): boolean {
  return !/\.sig$/.test(name) && name !== "latest.json";
}

export type ThemePreference = "auto" | "dark" | "light";

/**
 * 저장된 값 → 선호.
 *
 * ‼️ **Starlight 과 같은 규약**을 읽어야 한다. 두 표면이 `localStorage` 키 하나를
 *    공유하므로 여기서 갈리면 문서에서 고른 테마가 랜딩에서 다르게 읽힌다.
 *    Starlight 은 auto 를 빈 문자열로 적으므로 빈 문자열·없음·모르는 값이 모두 auto 다.
 */
export function themePreference(stored: string | null | undefined): ThemePreference {
  return stored === "dark" || stored === "light" ? stored : "auto";
}

/** 선호 → 저장할 값. auto 는 빈 문자열이다(Starlight 규약). */
export function storedTheme(pref: ThemePreference): string {
  return pref === "auto" ? "" : pref;
}

// ── DOM 배선 ────────────────────────────────────────────────────────────

// Starlight 문서 페이지와 같은 키 — 두 표면의 테마가 갈라지지 않게 한다.
const THEME_KEY = "starlight-theme";

function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null; /* private 모드 등 */
  }
}

function applyThemePreference(pref: ThemePreference): void {
  const root = document.documentElement;
  // ‼️ auto 는 `data-theme` 을 **지운다**. tokens.css 의 3-상태 규칙이 그때
  //    `prefers-color-scheme` 을 따르므로 시스템 설정이 바뀌면 새로고침 없이 따라간다.
  //    (Starlight 은 대신 matchMedia 를 듣는다 — 도달하는 곳은 같다.)
  if (pref === "auto") delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    localStorage.setItem(THEME_KEY, storedTheme(pref));
  } catch {
    /* private 모드 — 이 페이지에서만 적용된다 */
  }
}

function initTheme(): void {
  const select = document.querySelector<HTMLSelectElement>("#theme-select");
  if (!select) return;
  // ‼️ 저장값에서 읽는다. `dataset.theme` 은 auto 일 때 비어 있어 선호와 구분되지 않는다 —
  //    옛 토글이 그 값을 읽는 바람에 다크 시스템에서 첫 클릭이 아무 일도 하지 않았다.
  select.value = themePreference(readStoredTheme());
  select.addEventListener("change", () => {
    applyThemePreference(themePreference(select.value));
  });
}

function initLangSelect(): void {
  const select = document.querySelector<HTMLSelectElement>("#lang-select");
  if (!select) return;
  // 값은 그 로케일의 랜딩 경로다(마크업이 base 를 붙여 넣는다).
  select.addEventListener("change", () => {
    if (select.value) window.location.href = select.value;
  });
}

function initNavMenu(): void {
  const button = document.querySelector<HTMLButtonElement>("#nav-toggle");
  const panel = document.getElementById("nav-panel");
  if (!button || !panel) return;
  const setOpen = (open: boolean): void => {
    button.setAttribute("aria-expanded", String(open));
    panel.toggleAttribute("data-open", open);
  };
  button.addEventListener("click", () => {
    setOpen(button.getAttribute("aria-expanded") !== "true");
  });
  // 앵커를 누르면 닫는다 — 열린 패널이 그대로 남으면 방금 이동한 섹션을 가린다.
  for (const link of panel.querySelectorAll("a")) {
    link.addEventListener("click", () => setOpen(false));
  }
}

async function initDownload(): Promise<void> {
  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform;
  const os = detectOS(platform);
  const osLabel = document.getElementById("download-os");
  if (osLabel && OS_LABELS[os]) osLabel.textContent = ` · ${OS_LABELS[os]}`;
  try {
    const res = await fetch("https://api.github.com/repos/sayinel/baram/releases/latest");
    if (!res.ok) return; // 정적 폴백 링크가 그대로 동작한다
    const release = await res.json();
    const versionEl = document.getElementById("release-version");
    if (versionEl && release.tag_name) versionEl.textContent = release.tag_name;
    const primary = pickPrimaryAsset(release.assets, os);
    const btn = document.getElementById("download-primary");
    if (btn && primary) btn.setAttribute("href", primary.browser_download_url);
    const list = document.getElementById("asset-list");
    if (list && release.assets?.length) {
      list.textContent = "";
      for (const asset of release.assets as ReleaseAsset[]) {
        if (!isDownloadableAsset(asset.name)) continue;
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = asset.browser_download_url;
        link.textContent = asset.name;
        li.appendChild(link);
        list.appendChild(li);
      }
    }
  } catch {
    /* 네트워크·rate-limit 실패 — 정적 폴백 링크를 건드리지 않는다 */
  }
}

export function initLanding(): void {
  initNavMenu();
  initTheme();
  initLangSelect();
  void initDownload();
  void initStarBadges();
}
