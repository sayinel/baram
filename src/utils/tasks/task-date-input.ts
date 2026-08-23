// §303 입력 규칙의 값 파서 — ASCII만 받는다(한국어 자연어는 M3의 줄 파서 담당).
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MD_RE = /^(\d{1,2})\/(\d{1,2})$/;
const OFFSET_RE = /^\+(\d{1,3})$/;

/**
 * `due:`/`sched:`/`start:` 뒤의 값을 ISO 날짜로 바꾼다. 해석 불가면 null.
 *
 * M/D는 **올해로 보되, 이미 지났으면 내년으로 넘긴다.** 세 필드가 모두 미래
 * 지향이므로 필드별로 규칙을 다르게 두지 않는다.
 */
export function resolveDateInput(raw: string, today: Date): null | string {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const iso = ISO_RE.exec(s);
  if (iso) {
    const d = makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return d ? toIso(d) : null;
  }

  if (s === "t") return toIso(today);
  if (s === "m") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return toIso(d);
  }

  const off = OFFSET_RE.exec(s);
  if (off) {
    const d = new Date(today);
    d.setDate(d.getDate() + Number(off[1]));
    return toIso(d);
  }

  const md = MD_RE.exec(s);
  if (md) {
    const month = Number(md[1]);
    const day = Number(md[2]);
    const thisYear = makeDate(today.getFullYear(), month, day);
    if (!thisYear) return null;
    const base = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    if (thisYear.getTime() >= base.getTime()) return toIso(thisYear);
    const nextYear = makeDate(today.getFullYear() + 1, month, day);
    return nextYear ? toIso(nextYear) : null;
  }

  return null;
}

/** 달력상 실재하는 날짜인지 — Date의 롤오버로 검증한다. */
function makeDate(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month - 1, day);
  return d.getMonth() === month - 1 && d.getDate() === day ? d : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
