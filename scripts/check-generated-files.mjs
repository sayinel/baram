// 감사 순서 7: generated 디렉토리의 파일 집합을 고정한다.
//
// tokens:check의 `git diff --exit-code src/styles/generated`는 **기존** 생성
// 파일의 손편집은 잡지만(빌드가 덮어써 diff가 생긴다), 생성기가 모르는 새 tracked
// 파일 — 예컨대 override.css를 추가하고 base.css에서 import — 은 빌드가 건드리지
// 않으므로 diff 없이 통과한다. 예상 밖 산출물은 자동 삭제 대신 실패시킨다:
// 지우는 쪽이 편하지만, 실수로 커밋된 파일을 CI가 말없이 지우는 것보다 사람이
// 보게 하는 쪽이 안전하다.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const EXPECTED = new Set([
  "primitives.css",
  "semantic-light.css",
  "semantic-dark.css",
  "system-dark.css",
]);

// 숨김 파일도 걸러내지 않는다(적대 리뷰): `.override.css`처럼 dot로 시작하는
// 생성물은 filter에 삼켜져 게이트를 그대로 우회했다. macOS 부산물만 명시 예외.
const OS_ARTIFACTS = new Set([".DS_Store"]);
const actual = readdirSync("src/styles/generated").filter(
  (f) => !OS_ARTIFACTS.has(f),
);
const unexpected = actual.filter((f) => !EXPECTED.has(f));
const missing = [...EXPECTED].filter((f) => !actual.includes(f));

// filesystem 존재만으론 부족하다(적대 리뷰): 기대 파일을 Git에서 삭제해 커밋해도
// 빌드가 untracked로 재생성하고 `git diff`는 untracked를 안 보므로 통과했다.
// 기대 파일은 실제로 tracked여야 한다.
const tracked = new Set(
  execFileSync("git", ["ls-files", "src/styles/generated"], {
    encoding: "utf-8",
  })
    .split("\n")
    .filter(Boolean)
    .map((p) => p.split("/").pop()),
);
const untracked = [...EXPECTED].filter((f) => !tracked.has(f));

if (unexpected.length > 0 || missing.length > 0 || untracked.length > 0) {
  if (unexpected.length > 0)
    console.error(`Unexpected files in generated/: ${unexpected.join(", ")}`);
  if (missing.length > 0)
    console.error(`Missing generated files: ${missing.join(", ")}`);
  if (untracked.length > 0)
    console.error(
      `Generated files present but not tracked by git (deleted from the index?): ${untracked.join(", ")}`,
    );
  process.exit(1);
}
console.log(
  "generated/ file set OK (4 expected files, all tracked, nothing else).",
);
