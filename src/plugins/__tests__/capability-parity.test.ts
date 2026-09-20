// §69/§260 언어 간 드리프트 가드 — TS의 캡퍼빌리티 허용목록과 Rust
// `validate_manifest`의 `valid_caps`가 같아야 한다.
//
// ‼️ 이 파일이 존재하는 이유는 이 드리프트가 조용하기 때문이다: TS의
// `VALID_CAPABILITIES`는 `PluginCapability` 유니온에서 DERIVE되어 그 유니온에
// 뒤처질 수 없지만, Rust는 자기만의 손으로 쓴 배열을 따로 들고 있다. 유니온에
// 캡퍼빌리티를 더해도 Rust 쪽을 잊으면 `validate_manifest`를 거치는 경로가 모두
// 그 매니페스트를 `unknown capability: …`로 거절한다 — 크레이트 안 호출부는 둘로,
// dev-folder 로드(`read_manifest_at`)는 TypeScript가 보기도 전에, 아카이브
// 설치(`read_staged_manifest`)는 설치 자체를 막는다. 타입 오류도, TS 쪽 실패도 없다.
//
// 스크레이프 쪽 doctrine(카운트 단정 · 소스 텍스트를 받는 함수)은
// `scripts/rust-constants.ts` 헤더에 있다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { rustPluginCapabilities } from "../../../scripts/rust-constants";
import { VALID_CAPABILITIES } from "../manifest";

const PLUGIN_MOD_RS = join(process.cwd(), "src-tauri/src/plugin/mod.rs");
const rustSource = readFileSync(PLUGIN_MOD_RS, "utf8");

describe("§69/§260 capability allowlist parity (TS ↔ Rust)", () => {
  it("두 집합이 정확히 같다", () => {
    const rust = rustPluginCapabilities(rustSource);
    expect([...rust].sort()).toEqual([...VALID_CAPABILITIES].sort());
  });

  // 위 단정이 "둘 다 비어 있다"로 통과하지 않는다는 확인.
  it("스크레이프가 실제로 배열을 읽었다", () => {
    const rust = rustPluginCapabilities(rustSource);
    expect(rust.size).toBeGreaterThanOrEqual(13);
    expect(rust).toContain("editor");
    expect(rust).toContain("viewer");
  });

  // ‼️ 스크레이프가 "매치가 하나 있다"가 아니라 "**그** 선언"을 읽는다는 확인.
  // 함수가 파일이 아니라 소스 텍스트를 받는 이유가 이것이다 — 조작한 소스를
  // 먹여 거절을 실제로 관찰할 수 있다.
  it("선언이 둘이면 추측하지 않고 거절한다", () => {
    const doubled = `${rustSource}\n${rustSource}`;
    expect(() => rustPluginCapabilities(doubled)).toThrow(/refusing to guess/);
  });

  it("선언이 없으면 거절한다", () => {
    expect(() => rustPluginCapabilities("// nothing here")).toThrow(
      /refusing to guess/,
    );
  });
});
