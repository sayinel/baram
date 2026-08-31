// Multi-field dialog — extends showPrompt() pattern for link/image insertion
// Reuses ai-prompt-* CSS classes + field-dialog-* additions
//
// §308 M3-a가 이것을 태스크 칩의 피커로도 쓴다. 그래서 필드가 **초기값**(고칠 때는
// 현재 값이 들어 있어야 한다)과 **선택지**(우선순위는 5단계 중 하나다)를 받는다.
import type { Locale } from "../i18n";

import { t } from "../i18n";
import { useSettingsStore } from "../stores/settings/store";
import { buildDateField } from "./date-picker";

export interface FieldDialogOptions {
  fields: FieldSpec[];
  submitLabel?: string;
  title: string;
}

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldSpec {
  key: string;
  label: string;
  /** 있으면 `<select>`, 없으면 텍스트 입력. 빈 배열은 선택지가 없다는 뜻이 아니라 실수다. */
  options?: FieldOption[];
  placeholder?: string;
  /**
   * `"date"`면 텍스트 입력 **아래에 달력**이 붙는다. 값을 들고 있는 것은 여전히 입력이라
   * `+3`·`t`·`9/30` 같은 빠른 표기가 그대로 살아 있다 — 달력은 찾아보는 손잡이를 하나 더
   * 두는 것이지, 아는 사람의 길을 막는 것이 아니다.
   */
  type?: "date";
  /** 초기값 — 고치는 다이얼로그는 현재 값이 들어 있어야 한다. */
  value?: string;
}

/**
 * Show a modal dialog with multiple labeled input fields.
 * Returns a record of field values on submit, or null on cancel.
 *
 * Keyboard: Tab to move between fields, Enter on last field to submit, Escape to cancel.
 */
export function showFieldDialog(
  options: FieldDialogOptions,
): Promise<null | Record<string, string>> {
  // 두 버튼의 기본 문구는 이 파일이 정한다 — 호출부 넷이 제목·라벨만 번역해 넘기고
  // 있어서, 한국어 제목 아래 영어 "Cancel"이 붙은 다이얼로그가 실제로 떠 있었다.
  const locale = useSettingsStore.getState().locale as Locale;
  const { title, fields, submitLabel = t("dialog.insert", locale) } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ai-prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "ai-prompt-dialog";

    const heading = document.createElement("p");
    heading.className = "ai-prompt-label";
    heading.style.fontWeight = "600";
    heading.textContent = title;
    dialog.appendChild(heading);

    const inputs: (HTMLInputElement | HTMLSelectElement)[] = [];

    for (const field of fields) {
      const fieldLabel = document.createElement("label");
      fieldLabel.className = "field-dialog-label";
      fieldLabel.textContent = field.label;

      const control = field.options
        ? buildSelect(field, field.options)
        : buildInput(field);
      control.dataset.key = field.key;

      fieldLabel.appendChild(control);
      dialog.appendChild(fieldLabel);
      inputs.push(control);

      // 달력은 라벨 **밖에** 둔다. 안에 넣으면 날짜 칸을 누를 때마다 라벨이 자기
      // 컨트롤로 포커스를 되돌려, 방향키로 옮기던 자리를 매번 잃는다.
      if (field.type === "date" && control instanceof HTMLInputElement) {
        dialog.appendChild(
          buildDateField(control, new Date(), locale).calendar,
        );
      }
    }

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ai-prompt-btn ai-prompt-btn-cancel";
    cancelBtn.textContent = t("dialog.cancel", locale);

    const submitBtn = document.createElement("button");
    submitBtn.className = "ai-prompt-btn ai-prompt-btn-ok";
    submitBtn.textContent = submitLabel;

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const collectValues = (): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const input of inputs) {
        result[input.dataset.key!] = input.value;
      }
      return result;
    };

    const cleanup = (value: null | Record<string, string>) => {
      overlay.remove();
      resolve(value);
    };

    submitBtn.addEventListener("click", () => cleanup(collectValues()));
    cancelBtn.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup(null);
    });

    // Keyboard handling per input
    for (let i = 0; i < inputs.length; i++) {
      // ‼️ `HTMLElement`로 좁혀 받는다. 배열 원소가 input|select 합집합이면
      // `addEventListener`의 오버로드가 합쳐지면서 이벤트가 `Event`로 넓어지고
      // `e.key`가 사라진다.
      const control: HTMLElement = inputs[i];
      control.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup(null);
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (i < inputs.length - 1) {
            // Move to next field
            inputs[i + 1].focus();
          } else {
            // Last field — submit
            cleanup(collectValues());
          }
        }
      });
    }

    requestAnimationFrame(() => inputs[0]?.focus());
  });
}

function buildInput(field: FieldSpec): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "ai-prompt-input";
  input.type = "text";
  input.placeholder = field.placeholder ?? "";
  input.value = field.value ?? "";
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.setAttribute("autocorrect", "off");
  input.spellcheck = false;
  return input;
}

function buildSelect(
  field: FieldSpec,
  options: FieldOption[],
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "ai-prompt-input";
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  }
  // ‼️ 옵션을 다 붙인 **뒤에** 값을 세운다. 먼저 세우면 그 값을 가진 <option>이 아직
  // 없어 브라우저가 조용히 첫 항목으로 되돌리고, 고치기 다이얼로그가 언제나 첫 선택지로
  // 열린다.
  if (field.value !== undefined) select.value = field.value;
  return select;
}
