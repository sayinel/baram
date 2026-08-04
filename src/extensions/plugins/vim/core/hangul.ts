// §298 Vim Phase 1 — Korean find-target matching (design §5, device R7).
//
// A keydown can only ever produce a BARE jamo (ㄱ, ㅏ) while Korean text is
// composed syllables (강) — a literal comparison can never match, leaving
// f/t/F/T dead in Korean documents. The standard Korean-editor adaptation
// is 초성 search: a bare consonant jamo matches any syllable whose initial
// consonant is that jamo (fㄱ lands on 강, 김, 그 …). Pure string logic —
// this module must stay free of ProseMirror imports (core purity pin).

/** Initial consonants by syllable index — NFC arithmetic and the NFD
 *  conjoining choseong block (U+1100…) both map onto this table. */
const CHOSEONG_COMPAT = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];

const SYLLABLES_PER_CHOSEONG = 588; // 21 vowels × 28 finals

/** The initial consonant (compatibility jamo) of the first code point —
 *  null when the text does not start with hangul. */
export function choseongOf(text: string): null | string {
  const cp = text.codePointAt(0);
  if (cp === undefined) return null;
  if (cp >= 0xac00 && cp <= 0xd7a3) {
    return CHOSEONG_COMPAT[Math.floor((cp - 0xac00) / SYLLABLES_PER_CHOSEONG)];
  }
  if (cp >= 0x1100 && cp <= 0x1112) return CHOSEONG_COMPAT[cp - 0x1100];
  const char = String.fromCodePoint(cp);
  return CHOSEONG_COMPAT.includes(char) ? char : null;
}

/**
 * f/t target comparison: literal first (NFC-insensitively, so an NFC target
 * finds macOS-style NFD text), then 초성 widening — for a BARE consonant
 * jamo only. A full syllable target (`;` repeat of a pasted char) stays
 * exact: f강 must not land on 김.
 */
export function findTargetMatches(unit: string, char: string): boolean {
  if (unit.startsWith(char)) return true;
  if (unit.normalize("NFC").startsWith(char.normalize("NFC"))) return true;
  const bare = bareChoseong(char);
  return bare !== null && choseongOf(unit) === bare;
}

/** A SINGLE consonant jamo — compatibility (keyboard) or conjoining
 *  (U+1100 block, accepted by the key router) — as its compatibility form.
 *  Anything longer, syllables included, is null (device-R7 review). */
function bareChoseong(char: string): null | string {
  const cp = char.codePointAt(0);
  if (cp === undefined || String.fromCodePoint(cp) !== char) return null;
  if (cp >= 0x1100 && cp <= 0x1112) return CHOSEONG_COMPAT[cp - 0x1100];
  return CHOSEONG_COMPAT.includes(char) ? char : null;
}
