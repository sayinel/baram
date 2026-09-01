// 감사 순서 7: generated 디렉토리의 파일 집합을 고정한다.
//
// tokens:check의 `git diff --exit-code src/styles/generated`는 **기존** 생성
// 파일의 손편집은 잡지만(빌드가 덮어써 diff가 생긴다), 생성기가 모르는 새 tracked
// 파일 — 예컨대 override.css를 추가하고 base.css에서 import — 은 빌드가 건드리지
// 않으므로 diff 없이 통과한다. 예상 밖 산출물은 자동 삭제 대신 실패시킨다:
// 지우는 쪽이 편하지만, 실수로 커밋된 파일을 CI가 말없이 지우는 것보다 사람이
// 보게 하는 쪽이 안전하다.
import { readdirSync } from "node:fs";

const EXPECTED = new Set([
  "primitives.css",
  "semantic-light.css",
  "semantic-dark.css",
  "system-dark.css",
]);

const actual = readdirSync("src/styles/generated").filter(
  (f) => !f.startsWith("."),
);
const unexpected = actual.filter((f) => !EXPECTED.has(f));
const missing = [...EXPECTED].filter((f) => !actual.includes(f));

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0)
    console.error(`Unexpected files in generated/: ${unexpected.join(", ")}`);
  if (missing.length > 0)
    console.error(`Missing generated files: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("generated/ file set OK (4 expected files, nothing else).");
