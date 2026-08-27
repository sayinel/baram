// §303 워드 트리거 어휘 — 에디터 입력 규칙(§303)과 캡처 저장(§307D)이 **공유**한다.
//
// 두 벌로 두면 사용자가 배우는 언어가 둘로 갈라진다: 에디터에서 `due:m`이 📅로
// 바뀌는데 Quick Capture에서는 문자 그대로 남는 식으로. 어휘는 여기서만 정의한다.
//
// 패턴은 공유하지 않는다 — 입력 규칙은 스페이스를 치는 **순간** 발화하므로 끝을
// `\s$`로 못박아야 하고, 캡처는 다 쓴 한 줄을 훑으므로 그럴 수 없다. 두 쪽이
// 공유하는 것은 트리거 이름·이모지·경계 조건이지 정규식 자체가 아니다.

interface DateFieldToken {
  emoji: string;
  trigger: string;
}

/** 트리거 → 이모지. 이 순서가 한 줄에 적히는 canonical 순서다(§303). */
export const DATE_FIELDS: DateFieldToken[] = [
  { trigger: "start", emoji: "🛫" },
  { trigger: "sched", emoji: "⏳" },
  { trigger: "due", emoji: "📅" },
];

/** "3"(보통)은 이모지가 없다 — 마커는 안 남지만 트리거는 지워져야 한다. */
export const PRIORITY_EMOJI: Record<string, string> = {
  "1": "🔺",
  "2": "⏫",
  "3": "",
  "4": "🔽",
  "5": "⏬",
};

/**
 * 트리거 앞 경계 — 줄 시작이거나 공백. 폭 0 lookbehind라 매치에 그 경계 문자가
 * 섞이지 않는다. 이게 없으면 "overdue:8/30"의 "due:"가 "over" 중간에서 걸려
 * "over📅2026-08-30"이 돼버린다.
 */
export const TRIGGER_BOUNDARY = "(?<=^|\\s)";

/**
 * 트리거 뒤 경계 — 공백이거나 줄 끝. 입력 규칙은 스페이스를 치는 순간 발화하므로
 * `\s$`로 대신하지만, 다 쓴 줄을 훑는 캡처에는 이것이 필요하다: 없으면 `!123`이
 * `!1`로 걸려 우선순위가 되고 "23"이 본문에 남는다.
 */
export const TRIGGER_END = "(?=\\s|$)";

/** `prio:N` 과 `!N` 두 표기를 같은 결과로 받는다. */
export const PRIORITY_DIGITS = "(?:prio:|!)([12345])";
