// §306 §311 태스크 UI가 앱의 언어로 그려진다.
//
// 보고된 결함: 같은 버킷이 두 화면에서 다른 언어로 불렸다. 주간 리뷰는 `tasks.review.group.*`를
// 타서 "기한 초과 · 예정 밀림 · 예정 없음"이었고, 아젠다 패널은 하드코딩 표를 타서 같은 순간
// "Overdue · Past scheduled · No date"였다. 어느 언어를 골라도 한쪽이 틀린 상태다.
//
// 원인은 그 표가 아니라 그 위에 붙어 있던 주석이었다: "사이드바 패널의 사용자 노출 문자열은
// 영어가 이 코드베이스의 관례다." 관례를 관찰한 문장이 아니라 이 파일 자신을 보고 쓴 문장이고,
// 그 뒤로 이 패널에 더해진 문자열은 전부 그 문장을 근거로 영어로 남았다. 주석은 지웠지만,
// 지운 주석은 아무것도 막지 못한다 — 막는 것은 이 스캔이다.
//
// `locale-parity.test.ts`도 `label-key-coverage.test.ts`도 이것을 볼 수 없다. 둘 다 로케일
// **파일**을 검사하는데, 키가 된 적 없는 텍스트는 양쪽 파일 어디에도 없다.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scanForProse } from "../../../i18n/__tests__/prose-scanner";
import en from "../../../i18n/en.json";

const DIR = "src/components/tasks";
const KEYS = new Set(Object.keys(en));

/**
 * 프로즈가 아니면서 일반 규칙을 만들 만하지도 않은 리터럴 — 하나씩 이름을 적는다.
 * 늘리는 것이 패턴을 넓히는 일이 아니라 **의도적인 한 줄**이 되도록.
 */
const ALLOWED = new Set([
  // 파일에 실제로 쓰이는 태그 이름. 번역하면 문서에 다른 글자가 적힌다.
  "#someday",
  // 타입 주석이다 — `): Promise<BulkResult>`. 스캐너의 자식 추출은 `>…<` 사이를 보는데
  // 제네릭 인자가 그 모양을 만든다.
  ", counts: Counts, ): Promise",
  // `showToast`의 종류 인자.
  "error",
  "info",
  // 같은 타입 주석 사고 — `Promise<DocumentBatch>`.
  "Promise",
  // 정리 메뉴 항목의 id — 화면에 나오지 않는다(`runTaskTriageAction`이 분기한다).
  "someday-off",
  // 로거 문자열의 **꼬리** 조각. 머리(`[tasks] archive: backend skipped ${n} `)는 로거
  // 접두 규칙이 걷어내지만, 템플릿의 뒷조각은 그 표식을 갖지 못한다.
  "task(s) the panel had counted",
  // 또 하나의 타입 주석 — `React.KeyboardEvent<HTMLLIElement>`.
  //
  // 이 셋은 스캐너를 고치는 편이 옳다. 다만 그건 저널·플러그인 가드까지 함께 건드리는
  // 일이고, 그 가드들을 넓히는 대가로 이 가드를 세우는 건 값이 맞지 않는다.
  "void; onKeyDown: (e: React.KeyboardEvent",
]);

// 훅도 함께 본다. 이 결함이 실제로 살아남은 자리 하나가 `.tsx`가 아니라
// `use-reschedule-overdue.ts`의 확인 다이얼로그 문구였다 — 화면에 뜨는 문장인데
// 컴포넌트 파일이 아니라는 이유로 어떤 가드에도 걸리지 않았다.
const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .map((name) => `${DIR}/${name}`);

describe("no task component hardcodes user-facing text", () => {
  it("scanned every task component and hook", () => {
    // 빈 스캔은 아래 단언을 전부 통과시킨다. 이 디렉터리는 이 글을 쓸 때 12개였다.
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it.each(files)("%s", (file) => {
    expect(scanForProse(readFileSync(file, "utf8"), KEYS, ALLOWED)).toEqual({
      children: [],
      literals: [],
    });
  });
});

describe("아젠다와 주간 리뷰가 같은 버킷을 같은 이름으로 부른다", () => {
  // 두 화면이 각자 키를 가지면 한쪽만 고쳐지는 날이 온다. "예정 밀림"은 하루 만에
  // 이름이 두 번 바뀌었다 — 그때 두 벌이었다면 한 화면은 옛 이름으로 남았을 것이다.
  it("두 화면 모두 tasks.bucket.* 를 쓴다", () => {
    for (const file of ["TaskAgendaPanel.tsx", "WeeklyReviewDialog.tsx"]) {
      const source = readFileSync(`${DIR}/${file}`, "utf8");
      expect(source, file).toContain("`tasks.bucket.${");
      expect(source, file).not.toContain("tasks.review.group.");
    }
  });

  it("모든 버킷 이름이 두 로케일에 다 있다", () => {
    // 버킷을 하나 더할 때 키를 잊으면 화면에 키 이름이 그대로 뜬다.
    const buckets = [
      "overdue",
      "slipped",
      "today",
      "thisWeek",
      "later",
      "noDate",
      "done",
      "doneThisWeek",
    ];
    for (const bucket of buckets) {
      expect(KEYS, bucket).toContain(`tasks.bucket.${bucket}`);
    }
  });
});
