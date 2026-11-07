// §3.5 뷰어 버전은 세션 안에서 되풀이되지 않는 값이고, 저장 · 리로드를 기록할 때마다 새로 받는다 (#798).
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFileStore } from "../file";
import { nextViewerVersion } from "../viewer-version";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§3.5 viewer versions", () => {
  // 이것을 실패시키는 것: viewer-version.ts 의 `last + 1` 을 빼고 `Date.now()` 만 쓰면 같은 밀리초의 둘이
  // 같은 값이 된다.
  it("hands out a greater value each time, even within one millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000_000_000_000);
    const a = nextViewerVersion();
    const b = nextViewerVersion();
    expect(a).toBeGreaterThanOrEqual(5_000_000_000_000);
    expect(b).toBeGreaterThan(a);
  });

  // 이것을 실패시키는 것: file.ts 의 `updateLastSaveMtime` 에서 `viewerVersion` 을 빼면 저장해도 뷰어가 다시
  // 읽지 않는다.
  it("comes with each save or reload the file store records", () => {
    useFileStore.setState({ fileMtimes: new Map() });
    const store = useFileStore.getState();
    store.updateLastSaveMtime("/v/page.html", 1);
    const first = useFileStore.getState().fileMtimes.get("/v/page.html");
    store.updateLastSaveMtime("/v/page.html", 1);
    const second = useFileStore.getState().fileMtimes.get("/v/page.html");
    expect(first?.viewerVersion).toBeGreaterThan(0);
    expect(second?.viewerVersion).toBeGreaterThan(first?.viewerVersion ?? 0);
  });
});
