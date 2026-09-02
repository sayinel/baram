// §324-e 태스크 줄의 **한 줄 계약**. 사용자가 실물에서 찾은 두 결함이 여기 산다.
//
// ‼️ 이 파일은 변환만 보지 않고 **라운드트립**을 본다. 실제로 깨진 성질이 그것이기
// 때문이다: 파일에 적힌 줄이 편집을 거쳐 되돌아왔을 때 같아야 한다. 변환만 단정하면
// "링크로 바꿨다"는 말할 수 있어도 "그 줄이 파일에서 살아남는다"는 말하지 못한다.
import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeDetachedDoc } from "../../utils/editor/serialize-live-doc";
import { buildCaptureLine, imagesToLinks } from "../task-capture";

const schema = getSchema(createBaramExtensions());

/** 파일에 적힌 줄 → 파싱 → 직렬화. 편집 모드를 드나든 것에 해당한다. */
function roundTrip(line: string): string {
  return serializeDetachedDoc(markdownToProsemirror(line, schema));
}

describe("§324-e 이미지는 태스크에서 링크가 된다", () => {
  it("마크다운 이미지를 링크로 바꾸고 개수를 센다", () => {
    const r = imagesToLinks("본문 ![fig_2.3](assets/fig.png)");
    expect(r.text).toBe("본문 [fig_2.3](assets/fig.png)");
    expect(r.converted).toBe(1);
  });

  // 폭이 지정된 이미지는 `![]()`가 아니라 `<img>`로 직렬화된다
  // (`image-transformer.ts`). 마크다운 문법만 다루는 구현은 이 형태를 놓친다.
  it("HTML `<img>` 형태도 링크로 바꾼다", () => {
    const r = imagesToLinks(
      '본문 <img src="assets/fig.png" alt="fig_2.3" width="640" />',
    );
    expect(r.text).toBe("본문 [fig_2.3](assets/fig.png)");
    expect(r.converted).toBe(1);
  });

  // alt는 사용자가 보는 이름이다 — 잃으면 어느 파일인지 알 수 없다.
  it("alt를 링크 텍스트로 그대로 옮긴다", () => {
    expect(imagesToLinks("![fig_2.3_power_control](assets/a.png)").text).toBe(
      "[fig_2.3_power_control](assets/a.png)",
    );
  });

  it("이미지가 없으면 아무것도 바꾸지 않고 0을 돌려준다", () => {
    const r = imagesToLinks("그냥 [링크](x.md)와 본문");
    expect(r.text).toBe("그냥 [링크](x.md)와 본문");
    expect(r.converted).toBe(0);
  });

  it("여러 개를 모두 바꾸고 개수가 맞는다", () => {
    const r = imagesToLinks("![a](1.png) 사이 ![b](2.png)");
    expect(r.text).toBe("[a](1.png) 사이 [b](2.png)");
    expect(r.converted).toBe(2);
  });

  // ‼️ 계약은 `buildCaptureLine`이 지킨다 — 호출부가 잊을 수 없어야 한다.
  it("buildCaptureLine이 스스로 변환한다 — 호출부에 맡기지 않는다", () => {
    const line = buildCaptureLine(
      "태스크 이미지 ![fig](assets/fig.png)",
      "2026-09-02",
      [],
    )!;
    expect(line).toContain("[fig](assets/fig.png)");
    expect(line).not.toContain("![");
  });

  // ‼️ 실제로 깨졌던 성질. 이미지가 든 줄이 아니라 **링크가 든 줄**이 라운드트립을
  // 견디는지가 이 수정의 목적이다.
  it("링크가 든 태스크 줄은 라운드트립에서 한 줄로 남는다", () => {
    const line = buildCaptureLine(
      "태스크 이미지 ![fig](assets/fig.png)",
      "2026-09-02",
      [],
    )!;
    const after = roundTrip(`${line}\n`);
    expect(after.trimEnd().split("\n")).toHaveLength(1);
    expect(after).toContain("[fig](assets/fig.png)");
    expect(after).not.toContain("![");
  });
});

describe("§324-e 하드 브레이크가 `\\`를 남기지 않는다", () => {
  // 사용자의 정확한 재현: 한글을 치고 ⌘↩ → `inbox.md`의 줄이 `\`로 끝난다.
  it("줄 끝 하드 브레이크만 있어도 `\\`가 남지 않는다", () => {
    const line = buildCaptureLine("한글 텍스트\\\n", "2026-09-02", [])!;
    expect(line).toBe("- [ ] 한글 텍스트 ➕2026-09-02");
    expect(line).not.toContain("\\");
  });

  it("가운데 하드 브레이크는 공백이 된다 — 글자를 잃지 않는다", () => {
    expect(buildCaptureLine("첫 줄\\\n둘째 줄", "2026-09-02", [])).toBe(
      "- [ ] 첫 줄 둘째 줄 ➕2026-09-02",
    );
  });

  // 하드 브레이크의 두 번째 철자. 같은 것을 뜻하므로 같은 결과여야 한다.
  //
  // ‼️ 이 테스트는 `HARD_BREAK_RE`를 **지키지 않는다** — 공백 두 개는 전부 공백이라
  // `collapse`가 이미 접고, 패턴에서 그 분기를 빼도 이 단정은 통과한다(뮤테이션으로
  // 확인했고, 그래서 그 분기를 지웠다). 그래도 남겨 두는 이유는 두 철자가 같은
  // 결과를 낸다는 것이 사용자에게 보이는 성질이고, 어느 쪽이 그것을 지키든 깨지면
  // 알아야 하기 때문이다.
  it("공백 두 개 철자도 같은 결과를 낸다", () => {
    expect(buildCaptureLine("첫 줄  \n둘째 줄", "2026-09-02", [])).toBe(
      "- [ ] 첫 줄 둘째 줄 ➕2026-09-02",
    );
  });

  // ‼️ `normalizeBody`가 `collapse`를 두 번 부른다. 처리가 첫 `collapse` 뒤에 놓이면
  // 두 번째 패스가 이미 접힌 줄바꿈을 보지 못해 `\`가 남는다.
  it("연속 하드 브레이크도 남기지 않는다", () => {
    const line = buildCaptureLine("가\\\n나\\\n다", "2026-09-02", [])!;
    expect(line).toBe("- [ ] 가 나 다 ➕2026-09-02");
  });

  // 본문 안의 진짜 백슬래시는 사용자가 친 글자다 — 지우지 않는다.
  it("줄바꿈과 무관한 백슬래시는 건드리지 않는다", () => {
    expect(buildCaptureLine("경로 C:\\Users\\me 확인", "2026-09-02", [])).toBe(
      "- [ ] 경로 C:\\Users\\me 확인 ➕2026-09-02",
    );
  });
});
