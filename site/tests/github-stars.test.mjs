// 별 배지 — 랜딩 nav 와 문서 헤더가 공유하는 모듈.
// 옛 formatStarCount 테스트는 landing-helpers 에서 여기로 옮겼다.
import assert from "node:assert/strict";
import test from "node:test";

import { formatStarCount, loadStarLabel, starLabel } from "../src/scripts/github-stars.ts";

/** setItem 을 기록하는 최소 sessionStorage. */
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const okResponse = (body) => ({ ok: true, json: async () => body });

test("formatStarCount formats counts compactly", () => {
  assert.equal(formatStarCount(0), "0");
  assert.equal(formatStarCount(999), "999");
  assert.equal(formatStarCount(1000), "1k");
  assert.equal(formatStarCount(1500), "1.5k");
  assert.equal(formatStarCount("nope"), null);
  assert.equal(formatStarCount(Number.NaN), null);
});

test("starLabel 은 별표를 붙이고, 못 읽으면 null 이다", () => {
  assert.equal(starLabel(3), "★ 3");
  assert.equal(starLabel(undefined), null);
});

// ── 캐시 (§ 한도 방어) ────────────────────────────────────────────────
//
// ‼️ GitHub 비인증 한도는 IP 당 시간당 60회다. 캐시 없이 돌던 동안 실제로 소진돼
//    랜딩·문서 두 헤더에서 배지가 동시에 사라졌다 — 그래서 TTL 안이면 아예 부르지
//    않고, 실패하면 만료된 값이라도 계속 보여 준다(stale-while-error).

const HOUR = 60 * 60 * 1000;
const cached = (label, at) => ({ "baram-github-stars": JSON.stringify({ at, label }) });
const boom = () => {
  throw new Error("불러선 안 되는 fetch 를 불렀다");
};

test("TTL 안이면 API 를 두드리지 않는다", async () => {
  const storage = fakeStorage(cached("★ 42", 1000));
  assert.equal(await loadStarLabel(boom, storage, 1000 + HOUR), "★ 42");
});

test("처음 한 번만 받아 캐시에 시각과 함께 적는다", async () => {
  const storage = fakeStorage();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return okResponse({ stargazers_count: 1500 });
  };
  assert.equal(await loadStarLabel(fetchImpl, storage, 5000), "★ 1.5k");
  assert.deepEqual(JSON.parse(storage.data["baram-github-stars"]), { at: 5000, label: "★ 1.5k" });
  assert.equal(await loadStarLabel(fetchImpl, storage, 5000 + HOUR), "★ 1.5k");
  assert.equal(calls, 1, "두 번째 호출이 캐시를 쓰지 않았다");
});

test("TTL 이 지나면 다시 받아 갱신한다", async () => {
  const storage = fakeStorage(cached("★ 3", 0));
  const at = 7 * HOUR;
  assert.equal(await loadStarLabel(async () => okResponse({ stargazers_count: 9 }), storage, at), "★ 9");
  assert.deepEqual(JSON.parse(storage.data["baram-github-stars"]), { at, label: "★ 9" });
});

test("실패하면 만료된 값이라도 그대로 보여 준다 — 배지가 사라지지 않는다", async () => {
  const stale = () => fakeStorage(cached("★ 3", 0));
  const at = 7 * HOUR;
  assert.equal(await loadStarLabel(async () => ({ ok: false }), stale(), at), "★ 3", "rate-limit(403)");
  assert.equal(
    await loadStarLabel(async () => {
      throw new Error("offline");
    }, stale(), at),
    "★ 3",
    "네트워크 실패",
  );
  assert.equal(await loadStarLabel(async () => okResponse({}), stale(), at), "★ 3", "개수 없는 응답");
  // 실패를 캐시에 적어 낡은 값을 덮어써선 안 된다.
  const storage = stale();
  await loadStarLabel(async () => ({ ok: false }), storage, at);
  assert.deepEqual(JSON.parse(storage.data["baram-github-stars"]), { at: 0, label: "★ 3" });
});

test("보여 줄 것이 아무것도 없으면 null — 그때만 아이콘만 남는다", async () => {
  const storage = fakeStorage();
  assert.equal(await loadStarLabel(async () => ({ ok: false }), storage, 0), null);
  assert.equal(storage.data["baram-github-stars"], undefined, "실패를 캐시에 적었다");
});

test("손상된 캐시 값은 없는 것으로 보고 다시 받는다", async () => {
  for (const bad of ["★ 3", "{", "null", '{"label":3,"at":0}']) {
    const storage = fakeStorage({ "baram-github-stars": bad });
    assert.equal(
      await loadStarLabel(async () => okResponse({ stargazers_count: 5 }), storage, 0),
      "★ 5",
      `bad=${bad}`,
    );
  }
});

test("저장소가 없어도(차단·private) 동작한다", async () => {
  assert.equal(await loadStarLabel(async () => okResponse({ stargazers_count: 7 }), null, 0), "★ 7");
});
