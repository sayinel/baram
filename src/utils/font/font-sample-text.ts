// §351/§352 미리보기 문안 — 피커와 브라우저가 같은 문안을 쓴다.
//
// 한 곳에 두는 이유: 두 표면이 다른 문안을 쓰면 사용자가 설정 행에서 고른 것과
// 브라우저에서 본 것이 다르게 보인다.

/** 한글 팬그램. 받침·모음 조합이 넓게 퍼져 자모 렌더를 드러낸다. */
export const SAMPLE_KO = "다람쥐 헌 쳇바퀴에 타고파";

export const SAMPLE_EN = "The quick brown fox jumps over the lazy dog";

/**
 * 혼동되는 글리프들. 코드 서체에서는 iIlL1·oO0 구분이 곧 가독성이고, 본문
 * 서체에서도 숫자 폭과 따옴표 모양이 판단 근거가 된다.
 */
export const SAMPLE_GLYPHS = "0123456789 · iIlL1 · oO0 · —–- · “”‘’";

/** 코드 슬롯 미리보기 — 한글 주석이 고정폭에서 어떻게 눕는지 함께 보인다. */
export const SAMPLE_CODE = 'const 바람 = "가볍다"; // if (x !== y) { }';
