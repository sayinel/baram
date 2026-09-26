// §351/§352 — 글꼴 크기와 줄 높이를 화면에 적는 방법.
//
// 이 두 값은 설정 행과 폰트 브라우저, 두 표면에 동시에 보인다. 하나의 설정을
// 두 창으로 보는 것이므로 같은 값이 두 모양으로 적히면(16 vs 16.00, 1.7 vs
// 1.70) 사용자는 어느 쪽이 진짜인지 알 수 없고, 실제로는 둘 다 같은 병합값을
// 읽고 있다는 사실이 가려진다. 그래서 모양을 만드는 자리를 하나로 둔다.
//
// 단위(px)는 여기 없다 — 부르는 쪽이 값 칸에 붙인다: 설정 행(`appearance-dial-row.tsx`
// 의 `formatDialValue`, 코드 두 행은 `tabs/EditorTab.tsx`)과 브라우저 미리보기
// (`font-browser-preview.tsx`). 갈라지면 안 되는 것은 단위가 아니라 숫자의
// 자릿수다: `toFixed(2)` 를 한쪽만 바꾸면 두 표면이 어긋난다.

/** 글꼴 크기의 숫자 부분. 정수 px 스텝이라 소수점이 없다. */
export function fontSizeNumber(px: number): string {
  return String(px);
}

/** 줄 높이의 숫자 부분. 스텝이 0.05 라 두 자리로 고정한다 — 고정하지 않으면
 *  1.7 과 1.75 가 자릿수만으로 서로 다른 폭을 차지해 드래그 중에 흔들린다. */
export function lineHeightNumber(value: number): string {
  return value.toFixed(2);
}
