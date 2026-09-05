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
  // ‼️ 패턴은 `open({` 접두사를 요구하지 않는다. `open({ recursive: true,
  // directory: true })`처럼 키 순서만 바뀌어도 예전 정규식(`open\({\s*directory:`)은
  // 놓쳤다 — 스캔 가드는 "**어떤** 매치가 있다"가 아니라 "그 형태가 없다"를 말해야
  // 하고, 매치 조건에 무관한 요소(키 순서)를 넣으면 그 힘이 사라진다.
  it.each(MIGRATED)(
    "%s는 디렉터리 선택에 plugin-dialog를 쓰지 않는다",
    (file) => {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/directory:\s*true/);
    },
  );

  it("파일 열기가 Rust 피커를 쓴다", () => {
    const src = readFileSync("src/hooks/use-file-operations.ts", "utf8");
    expect(src).toContain("pickApprovedFile");
  });

  // ContextAddMenu.tsx는 디렉터리 피커(handleOpenFolder, handleInitVault)와
  // 파일 피커(handleOpenFile) 셋 다 이전 대상이라, 위의 directory:true 패턴만으로는
  // 세 번째(파일) 호출부를 못 잡는다 — plugin-dialog 자체를 더 이상 안 쓴다고 단정한다.
  // §332 리뷰 I5 — Rust 피커로 옮기면서 이전 JS 목록의 `Text`와 `All Files`가 조용히
  // 빠졌다. 그러면 앱의 기본 "파일 열기"(Cmd+O)로 .txt·.json·.csv·.yaml·.toml을 **열 수
  // 없다.** 네이티브 다이얼로그는 테스트에서 띄울 수 없으므로 소스 스캔으로 고정한다 —
  // 행동 테스트가 아니라 회귀 고정이라는 점을 분명히 해 둔다.
  it("파일 피커가 임의 확장자를 막지 않는다", () => {
    const src = readFileSync("src-tauri/src/commands/approval_cmd.rs", "utf8");
    expect(src).toContain('add_filter("All Files", &["*"])');
    expect(src).toContain('add_filter("Text", &["txt", "text"])');
  });

  it("ContextAddMenu.tsx는 plugin-dialog를 전혀 쓰지 않는다", () => {
    const src = readFileSync(
      "src/components/layout/ContextAddMenu.tsx",
      "utf8",
    );
    expect(src).not.toContain("@tauri-apps/plugin-dialog");
  });
});
