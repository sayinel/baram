// §4.8 Context Menu — shared types
export interface MenuItem {
  action: () => void;
  /** 지금 고른 값인가. `MenuList` 가 라벨 뒤에 이름 붙은 체크 아이콘을 그린다 — 라벨 문자열에
   *  ✓ 를 붙이지 않는다(스크린리더가 라벨의 일부로 읽고, 테스트가 라벨을 비교할 때 벗겨내야 했다). */
  checked?: boolean;
  /**
   * §391 spec 0070 D5 — a dimmed second word after the label: the plugin a right-click item comes
   * from. Text inside the button, so the accessible name reads "label detail" — the source is
   * read out too, which is wanted.
   */
  detail?: string;
  label: string;
  separator?: boolean;
}
