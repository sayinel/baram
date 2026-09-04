// §332 — 컨텍스트를 만드는 경로는 JS 다이얼로그가 아니라 Rust 피커를 써야 한다.
// 소스 스캔인 이유: 아홉 곳이 서로 다른 컴포넌트에 흩어져 있어 렌더 테스트로는
// 전부를 한 번에 고정할 수 없고, 새 호출부가 추가될 때 잡아야 하는 것은 "import"다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATED = [
  "src/components/sidebar/FileTree.tsx",
  "src/hooks/use-file-operations.ts",
  "src/components/settings/tabs/VaultTab.tsx",
  "src/components/layout/ContextAddMenu.tsx",
  "src/services/vault-create.ts",
  "src/components/settings/tabs/general/JournalSection.tsx",
  "src/components/settings/tabs/general/ZettelkastenSection.tsx",
  "src/components/settings/tabs/general/TasksSection.tsx",
];

describe("§332 승인 피커 이전", () => {
  it.each(MIGRATED)(
    "%s는 디렉터리 선택에 plugin-dialog를 쓰지 않는다",
    (file) => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/open\(\{\s*directory:\s*true/);
    },
  );

  it("파일 열기가 Rust 피커를 쓴다", () => {
    const src = readFileSync("src/hooks/use-file-operations.ts", "utf8");
    expect(src).toContain("pickApprovedFile");
  });
});
