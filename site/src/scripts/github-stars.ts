// GitHub 별 개수 배지 — 랜딩 nav 와 **문서 헤더가 같은 코드**를 쓴다.
// 두 표면 모두 `[data-github-stars]` 훅을 두고, 못 읽으면 비운 채로 남긴다
// (site.css·SocialIcons.astro 의 `:empty` 규칙이 그때 아이콘만 남긴다).

const REPO_API = "https://api.github.com/repos/sayinel/baram";

// ‼️ 캐시가 이 모듈의 절반이다. GitHub 비인증 한도는 **IP 당 시간당 60회**이고, 문서는
//    MPA 라 페이지를 옮길 때마다 이 스크립트가 새로 켜진다(랜딩은 릴리스 정보까지 받아
//    한 번에 2회를 쓴다). 캐시가 없으면 공용 IP(회사 NAT·모바일 캐리어)나 새로고침이
//    잦은 방문자가 403 을 만나고, 그때부터 두 헤더에서 배지가 사라진다 — 실제로 검증
//    도중 한 번 소진돼 그렇게 됐다.
//
//    그래서 `localStorage` + TTL 이다(탭 수명만 사는 sessionStorage 가 아니다): 탭·방문을
//    넘겨 살아남아 호출 자체를 줄이고, **fetch 가 실패하면 만료된 값이라도 그대로 보여
//    준다**(stale-while-error). 별 개수는 몇 시간 낡아도 무해하지만 사라지면 눈에 띈다.
const CACHE_KEY = "baram-github-stars";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type StarStorage = Pick<Storage, "getItem" | "setItem">;

interface CachedStars {
  /** 배지에 넣을 문자열 그대로 — 형식이 바뀌어도 낡은 값이 깨지지 않는다. */
  label: string;
  /** 받은 시각(epoch ms). TTL 판정과 stale 판정을 이 하나로 한다. */
  at: number;
}

function readCache(storage: StarStorage | null): CachedStars | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(CACHE_KEY) ?? null;
  } catch {
    return null; /* private 모드 등 */
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as CachedStars).label === "string" &&
      typeof (parsed as CachedStars).at === "number"
    ) {
      return parsed as CachedStars;
    }
  } catch {
    /* 손상·옛 형식 — 없는 것으로 본다 */
  }
  return null;
}

export function formatStarCount(count: unknown): string | null {
  if (typeof count !== "number" || !Number.isFinite(count)) return null;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
}

/** 배지에 넣을 문자열. 개수를 못 읽으면 null — 그러면 배지를 비워 둔다. */
export function starLabel(count: unknown): string | null {
  const formatted = formatStarCount(count);
  return formatted === null ? null : `★ ${formatted}`;
}

/**
 * 신선한 캐시 → 그대로. 아니면 API 를 받아 캐시에 적는다.
 * 실패하면 **만료된 캐시라도** 돌려주고, 그것마저 없을 때만 null 이다(= 아이콘만 남기기).
 */
export async function loadStarLabel(
  fetchImpl: typeof fetch,
  storage: StarStorage | null,
  now: number = Date.now(),
): Promise<string | null> {
  const cached = readCache(storage);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.label;
  try {
    const res = await fetchImpl(REPO_API);
    if (!res.ok) return cached?.label ?? null; // rate-limit 포함
    const repo = (await res.json()) as { stargazers_count?: unknown };
    const label = starLabel(repo.stargazers_count);
    if (label === null) return cached?.label ?? null;
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({ at: now, label } satisfies CachedStars));
    } catch {
      /* 용량·private 모드 — 이 페이지에서만 보인다 */
    }
    return label;
  } catch {
    return cached?.label ?? null; // 네트워크 실패
  }
}

function localStorageOrNull(): StarStorage | null {
  try {
    return localStorage;
  } catch {
    return null; // 사이트 데이터 차단
  }
}

export async function initStarBadges(): Promise<void> {
  const targets = document.querySelectorAll<HTMLElement>("[data-github-stars]");
  if (targets.length === 0) return;
  const label = await loadStarLabel(fetch, localStorageOrNull());
  if (label === null) return;
  for (const el of targets) el.textContent = label;
}
