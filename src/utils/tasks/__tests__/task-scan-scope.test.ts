// §312.1 스캔 범위 — 무엇을 스캔하고 무엇을 겹쳐 세지 않는가.
import { describe, expect, it } from "vitest";

import { dedupeScanRoots, resolveScanRoots } from "../task-scan-scope";

const SRC = {
  rootPath: "/vault",
  tasksHome: "/home",
  vaultPaths: ["/vault", "/other"],
};

describe("resolveScanRoots", () => {
  it("태스크 홈 범위는 홈 하나만 본다 — 배수구가 켜지는 범위다", () => {
    expect(resolveScanRoots("tasksHome", SRC)).toEqual(["/home"]);
  });

  it("현재 볼트 범위는 활성 컨텍스트 루트만 본다 — §312.1 이전의 동작", () => {
    expect(resolveScanRoots("currentVault", SRC)).toEqual(["/vault"]);
  });

  it("전체 범위는 열린 vault 전부에 태스크 홈을 더한다", () => {
    // 홈을 빼면 방금 캡처한 태스크가 **기본 화면**에서 사라진다 — §312.1이 "가장 나쁜
    // 조합"이라고 부른 상태다. 캡처가 가는 곳을 목록이 보지 않는 것.
    expect(resolveScanRoots("allVaults", SRC)).toEqual([
      "/vault",
      "/other",
      "/home",
    ]);
  });

  it("홈이 열린 vault 안이면 아무것도 늘지 않는다", () => {
    expect(
      resolveScanRoots("allVaults", { ...SRC, tasksHome: "/vault/zettel" }),
    ).toEqual(["/vault", "/other"]);
  });

  it("홈이 없으면 그 범위는 빈 목록이다 — 스캔하지 않는다", () => {
    expect(resolveScanRoots("tasksHome", { ...SRC, tasksHome: null })).toEqual(
      [],
    );
  });

  it("볼트를 열지 않았으면 현재 볼트 범위는 빈 목록이다", () => {
    expect(
      resolveScanRoots("currentVault", { ...SRC, rootPath: null }),
    ).toEqual([]);
  });
});

describe("dedupeScanRoots", () => {
  it("빈 값과 중복을 걸러 낸다", () => {
    expect(dedupeScanRoots(["/a", null, "/a", "", "/b"])).toEqual(["/a", "/b"]);
  });

  it("이미 담은 루트 아래에 있는 루트는 버린다", () => {
    // Zettel 디렉터리를 vault 안에 두는 것은 흔한 배치다. 그대로 두 번 스캔하면 같은
    // 태스크가 두 번 뜨고, 체크하면 한 줄만 사라져 나머지 하나가 유령이 된다.
    expect(dedupeScanRoots(["/vault", "/vault/zettel"])).toEqual(["/vault"]);
  });

  it("나중에 온 상위 루트가 앞서 담은 하위 루트를 흡수한다", () => {
    // 순서가 반대여도 결과는 같아야 한다 — 볼트탭 순서에 결과가 매달리면 안 된다.
    expect(dedupeScanRoots(["/vault/zettel", "/vault"])).toEqual(["/vault"]);
  });

  it("상위 하나가 여러 하위를 한꺼번에 흡수한다", () => {
    expect(dedupeScanRoots(["/v/a", "/v/b", "/v"])).toEqual(["/v"]);
  });

  it("이름이 겹치는 이웃은 하위가 아니다", () => {
    // `/vault`가 `/vaults`를 삼키면 사용자의 다른 볼트가 통째로 스캔에서 사라진다.
    expect(dedupeScanRoots(["/vault", "/vaults"])).toEqual([
      "/vault",
      "/vaults",
    ]);
  });

  it("구분자 차이만으로 서로 다른 루트가 되지 않는다", () => {
    expect(dedupeScanRoots(["/vault", "/vault/", "/vault/./"])).toEqual([
      "/vault",
    ]);
  });

  it("Windows 구분자도 같은 루트로 본다", () => {
    expect(dedupeScanRoots([String.raw`C:\v`, "C:/v/zettel"])).toEqual([
      String.raw`C:\v`,
    ]);
  });

  it("사용자의 원본 문자열을 그대로 돌려준다 — 정규화는 비교에만 쓴다", () => {
    // IPC가 받는 것은 사용자의 경로다. 정규화한 값을 넘기면 플랫폼에 따라 열지 못할
    // 수 있다.
    expect(dedupeScanRoots([String.raw`C:\v`])).toEqual([String.raw`C:\v`]);
  });

  it("입력 순서를 지킨다 — 볼트탭 순서가 목록 순서다", () => {
    expect(dedupeScanRoots(["/b", "/a", "/c"])).toEqual(["/b", "/a", "/c"]);
  });
});
