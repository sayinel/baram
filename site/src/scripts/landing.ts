// 랜딩의 클라이언트 로직. 옛 `site/main.js` 에서 이주했다.
// 언어 전환은 여기 없다 — URL 라우팅이 대신한다(옛 localStorage 토글 폐기).

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

export function formatStarCount(count: unknown): string | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
}

/** 다음 테마. Starlight 과 같은 3-상태(auto 는 시스템 설정 따라감)를 쓴다. */
export function nextTheme(current: string | null): "light" | "dark" {
  return current === "dark" ? "light" : "dark";
}

// ── DOM 배선 ────────────────────────────────────────────────────────────

function initTheme(): void {
  const button = document.getElementById("theme-toggle");
  if (!button) return;
  button.addEventListener("click", () => {
    const root = document.documentElement;
    const theme = nextTheme(root.dataset.theme ?? null);
    root.dataset.theme = theme;
    try {
      // Starlight 문서 페이지와 같은 키 — 두 표면의 테마가 갈라지지 않게 한다.
      localStorage.setItem("starlight-theme", theme);
    } catch {
      /* private 모드 — 이 페이지에서만 적용된다 */
    }
  });
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

async function initStarBadge(): Promise<void> {
  const el = document.getElementById("github-stars");
  if (!el) return;
  try {
    const res = await fetch("https://api.github.com/repos/sayinel/baram");
    if (!res.ok) return; // "GitHub" 폴백 텍스트 유지
    const repo = await res.json();
    const formatted = formatStarCount(repo.stargazers_count);
    if (formatted) el.textContent = formatted;
  } catch {
    /* 네트워크 실패 — 폴백 텍스트 유지 */
  }
}

export function initLanding(): void {
  initTheme();
  void initDownload();
  void initStarBadge();
}
