// §308 M3-a가 이 다이얼로그를 태스크 칩의 피커로도 쓴다 — 그래서 **초기값**과
// **선택지**가 생겼다. 여기서 보는 것은 그 둘, 그리고 기존 호출부가 안 깨졌다는 것.
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { showFieldDialog } from "../field-dialog";

function click(label: string) {
  const btn = [...dialog().querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  if (!btn) throw new Error(`"${label}" 버튼이 없다`);
  btn.click();
}

function control<T extends HTMLElement>(key: string): T {
  const el = dialog().querySelector<T>(`[data-key="${key}"]`);
  if (!el) throw new Error(`${key} 컨트롤이 없다`);
  return el;
}

function dialog(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".ai-prompt-dialog");
  if (!el) throw new Error("다이얼로그가 열리지 않았다");
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  useSettingsStore.setState({ locale: "en" });
});

describe("showFieldDialog — 텍스트 필드", () => {
  it("초기값이 입력에 들어가고 그대로 돌아온다", async () => {
    const promise = showFieldDialog({
      fields: [{ key: "date", label: "Date", value: "2026-08-30" }],
      title: "고치기",
    });

    expect(control<HTMLInputElement>("date").value).toBe("2026-08-30");
    click("Insert");
    await expect(promise).resolves.toEqual({ date: "2026-08-30" });
  });

  it("초기값이 없으면 빈 칸이다 — 기존 호출부의 동작", async () => {
    const promise = showFieldDialog({
      fields: [{ key: "url", label: "URL", placeholder: "https://" }],
      title: "삽입",
    });

    const input = control<HTMLInputElement>("url");
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("https://");
    click("Cancel");
    await expect(promise).resolves.toBeNull();
  });
});

describe("showFieldDialog — 선택지", () => {
  const OPTIONS = [
    { label: "Urgent", value: "1" },
    { label: "High", value: "2" },
    { label: "Normal", value: "" },
  ];

  it("<select>를 만들고 고른 값을 돌려준다", async () => {
    const promise = showFieldDialog({
      fields: [{ key: "priority", label: "Priority", options: OPTIONS }],
      title: "우선순위",
    });

    const select = control<HTMLSelectElement>("priority");
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Urgent",
      "High",
      "Normal",
    ]);

    select.value = "2";
    click("Insert");
    await expect(promise).resolves.toEqual({ priority: "2" });
  });

  it("‼️ 초기값이 그 선택지로 열린다", async () => {
    // 옵션을 붙이기 **전에** 값을 세우면 브라우저가 조용히 첫 항목으로 되돌린다 —
    // 고치기 다이얼로그가 언제나 "긴급"으로 열리고, 사용자가 손대지 않고 확인하면
    // 우선순위가 바뀐다.
    const promise = showFieldDialog({
      fields: [
        { key: "priority", label: "Priority", options: OPTIONS, value: "2" },
      ],
      title: "우선순위",
    });

    expect(control<HTMLSelectElement>("priority").value).toBe("2");
    click("Cancel");
    await promise;
  });

  it("빈 문자열 선택지도 고를 수 있다 — '보통'은 값이 없다", async () => {
    const promise = showFieldDialog({
      fields: [
        { key: "priority", label: "Priority", options: OPTIONS, value: "" },
      ],
      title: "우선순위",
    });

    expect(control<HTMLSelectElement>("priority").value).toBe("");
    click("Insert");
    await expect(promise).resolves.toEqual({ priority: "" });
  });
});

describe("버튼 문구", () => {
  it("‼️ 취소는 앱의 언어를 탄다", async () => {
    // 호출부 넷이 제목·라벨만 번역해 넘기고 있어서, 한국어 제목 아래 영어 "Cancel"이
    // 붙은 다이얼로그가 실제로 떠 있었다(태스크 정리의 날짜 입력).
    useSettingsStore.setState({ locale: "ko" });
    const promise = showFieldDialog({
      fields: [{ key: "date", label: "날짜" }],
      title: "기한 설정",
    });

    const labels = [...dialog().querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).toContain("취소");
    click("취소");
    await expect(promise).resolves.toBeNull();
  });

  it("호출부가 준 제출 라벨이 이긴다", async () => {
    const promise = showFieldDialog({
      fields: [{ key: "date", label: "Date" }],
      submitLabel: "Set",
      title: "Set due date",
    });

    click("Set");
    await promise;
  });
});

describe("‼️ 날짜 필드에는 달력이 붙는다", () => {
  it('`type: "date"`면 입력 아래에 달력이 선다', () => {
    // 이것이 없으면 `/due`는 텍스트 입력만 열고, 그건 `due:m `보다 느리다.
    const promise = showFieldDialog({
      fields: [{ key: "date", label: "Date", type: "date" }],
      title: "기한",
    });

    expect(dialog().querySelector(".date-picker")).not.toBeNull();
    click("Cancel");
    return promise;
  });

  it("달력에서 고른 값이 그대로 돌아온다", async () => {
    const promise = showFieldDialog({
      fields: [
        { key: "date", label: "Date", type: "date", value: "2026-09-16" },
      ],
      title: "기한",
    });

    dialog().querySelector<HTMLElement>('[data-iso="2026-09-20"]')!.click();
    click("Insert");
    await expect(promise).resolves.toEqual({ date: "2026-09-20" });
  });

  it("‼️ 달력은 라벨 밖에 있다", () => {
    // 라벨 안에 넣으면 날짜 칸을 누를 때마다 라벨이 자기 컨트롤로 포커스를 되돌려,
    // 방향키로 옮기던 자리를 매번 잃는다.
    const promise = showFieldDialog({
      fields: [{ key: "date", label: "Date", type: "date" }],
      title: "기한",
    });

    expect(dialog().querySelector("label .date-picker")).toBeNull();
    expect(dialog().querySelector(".date-picker")).not.toBeNull();
    click("Cancel");
    return promise;
  });

  it("날짜 필드가 아니면 달력이 없다 — 링크·이미지 삽입은 그대로다", () => {
    const promise = showFieldDialog({
      fields: [{ key: "url", label: "URL" }],
      title: "삽입",
    });

    expect(dialog().querySelector(".date-picker")).toBeNull();
    click("Cancel");
    return promise;
  });
});
