// §314 추출의 바깥 껍데기 — 문서에 쓰지 않는다는 것이 여기서 지켜지는 계약이다.
//
// 다듬기 자체는 `action-items.test.ts`가 본다. 여기서 보는 것은 셋이다:
// 무엇을 모델에 보내는가 · 결과가 **어디로** 가는가 · 못 갈 때 무엇을 알리는가.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { extractActionItems, extractionSource } from "../extract-action-items";

const llmComplete = vi.hoisted(() => vi.fn());
const createLLMStream = vi.hoisted(() => vi.fn());
const isLLMAllowed = vi.hoisted(() => vi.fn(() => true));
const getConfigForTask = vi.hoisted(() =>
  vi.fn(() => ({
    baseUrl: "",
    configured: true,
    model: "m",
    provider: "anthropic",
  })),
);

// 설정 스토어가 뒤에서 `getConfig`/`setConfig`를 부른다 — 모의에 없으면 그때마다
// 에러 로그가 쏟아져 진짜 실패가 묻힌다.
vi.mock("../../../ipc/invoke", () => ({
  getConfig: async () => null,
  llmComplete,
  setConfig: async () => {},
}));
vi.mock("../../llm-stream", () => ({ createLLMStream }));
vi.mock("../../privacy-check", () => ({
  getFilePrivacy: () => "normal",
  isLLMAllowed,
}));
vi.mock("../../model-selection", () => ({ getConfigForTask }));
vi.mock("../../editor/mutation-tasks", () => ({
  registerEditorMutationTask: () => ({
    addCleanup: () => {},
    finish: () => {},
    isLive: () => live,
  }),
}));

let live = true;

/** 모델이 이 답을 흘려보낸다고 세운다. */
function answers(text: string) {
  createLLMStream.mockImplementation(
    async (_id: string, cb: { onToken: (t: string) => void }) => {
      // 토큰이 쪼개져 와도 결과가 같아야 한다 — 다듬기는 다 받은 뒤에 한다.
      for (const chunk of text.match(/[\s\S]{1,7}/g) ?? []) cb.onToken(chunk);
      return () => {};
    },
  );
}

/** `extractActionItems`가 보는 최소한의 에디터. */
function editorWith(text: string, selected?: [number, number]) {
  const doc = {
    content: { size: text.length + 2 },
    textBetween: (from: number, to: number) => text.slice(from - 1, to - 1),
    textContent: text,
  };
  const [from, to] = selected ?? [1, 1];
  return { state: { doc, selection: { from, to } }, view: {} } as never;
}

const toasts = () => useUIStore.getState().toast;

beforeEach(() => {
  vi.clearAllMocks();
  live = true;
  useSettingsStore.setState({ locale: "en" });
  useUIStore.setState({ pendingInsertTasks: null });
  useUIStore.getState().dismissToast();
  llmComplete.mockResolvedValue(undefined);
  isLLMAllowed.mockReturnValue(true);
  getConfigForTask.mockReturnValue({
    baseUrl: "",
    configured: true,
    model: "m",
    provider: "anthropic",
  });
});

describe("무엇을 보내는가", () => {
  it("선택이 있으면 그것만", () => {
    expect(extractionSource(editorWith("회의록 전체", [1, 4]))).toBe("회의록");
  });

  it("‼️ 선택이 없으면 문서 전체 — 회의록 한 편이 곧 문맥이다", () => {
    expect(extractionSource(editorWith("회의록 전체"))).toBe("회의록 전체");
  });
});

describe("‼️ 결과는 문서가 아니라 미리보기 대기열로 간다", () => {
  it("다듬은 태스크가 대기열에 놓인다", async () => {
    answers("여기 있습니다:\n- [ ] 보고서 초안\n- [ ] 예산 확인");
    await extractActionItems(editorWith("회의록"));

    expect(useUIStore.getState().pendingInsertTasks).toBe(
      "- [ ] 보고서 초안\n- [ ] 예산 확인",
    );
  });

  it("‼️ 다듬기를 지난 것만 나간다 — 머리말은 대기열에도 없다", async () => {
    answers("Here are the action items:\n- [ ] Ship it");
    await extractActionItems(editorWith("회의록"));

    expect(useUIStore.getState().pendingInsertTasks).not.toContain("Here are");
  });

  it("토막으로 와도 결과가 같다 — 다 받은 뒤에 다듬는다", async () => {
    answers("- [ ] 예산 확인");
    await extractActionItems(editorWith("회의록"));
    expect(useUIStore.getState().pendingInsertTasks).toBe("- [ ] 예산 확인");
  });

  it("프롬프트는 `action-items.ts`의 그것 하나다", async () => {
    answers("- [ ] x");
    await extractActionItems(editorWith("회의록"));
    expect(llmComplete.mock.calls[0][3]).toContain("Do NOT convert it");
  });
});

describe("갈 수 없을 때", () => {
  it("뽑을 내용이 없으면 모델을 부르지 않는다", async () => {
    await extractActionItems(editorWith("   "));
    expect(llmComplete).not.toHaveBeenCalled();
    expect(toasts()?.message).toContain("Nothing to extract");
  });

  it("모델이 없으면 알리고 끝낸다", async () => {
    getConfigForTask.mockReturnValue({
      baseUrl: "",
      configured: false,
      model: "m",
      provider: "anthropic",
    });
    await extractActionItems(editorWith("회의록"));
    expect(llmComplete).not.toHaveBeenCalled();
    expect(toasts()?.type).toBe("error");
  });

  it("프라이버시에 막히면 보내지 않는다", async () => {
    isLLMAllowed.mockReturnValue(false);
    await extractActionItems(editorWith("회의록"));
    expect(llmComplete).not.toHaveBeenCalled();
    expect(toasts()?.type).toBe("error");
  });

  it("‼️ 남는 줄이 없으면 빈 미리보기를 띄우지 않는다", async () => {
    // 받아들일 것이 없는 화면을 띄우느니 못 찾았다고 말하는 편이 낫다.
    answers("이 글에는 액션 아이템이 없습니다.");
    await extractActionItems(editorWith("회의록"));

    expect(useUIStore.getState().pendingInsertTasks).toBeNull();
    expect(toasts()?.message).toContain("No action items");
  });

  it("요청이 실패하면 알린다", async () => {
    answers("- [ ] x");
    llmComplete.mockRejectedValue(new Error("boom"));
    await extractActionItems(editorWith("회의록"));

    expect(useUIStore.getState().pendingInsertTasks).toBeNull();
    expect(toasts()?.type).toBe("error");
  });

  it("‼️ 문서가 바뀌었으면 늦게 온 답을 버린다", async () => {
    // 탭을 옮긴 뒤 도착한 답이 새 문서에 미리보기를 띄우면, 사용자는 읽지도 않은
    // 문서에서 뽑힌 할 일을 보게 된다.
    answers("- [ ] 예산 확인");
    llmComplete.mockImplementation(async () => {
      live = false;
    });
    await extractActionItems(editorWith("회의록"));

    expect(useUIStore.getState().pendingInsertTasks).toBeNull();
  });

  it("스트림을 반드시 닫는다 — 실패한 경로에서도", async () => {
    const close = vi.fn();
    createLLMStream.mockResolvedValue(close);
    llmComplete.mockRejectedValue(new Error("boom"));
    await extractActionItems(editorWith("회의록"));
    expect(close).toHaveBeenCalled();
  });
});
