// Multi-field dialog — extends showPrompt() pattern for link/image insertion
// Reuses ai-prompt-* CSS classes + field-dialog-* additions

export interface FieldSpec {
  key: string;
  label: string;
  placeholder?: string;
}

export interface FieldDialogOptions {
  title: string;
  fields: FieldSpec[];
  submitLabel?: string;
}

/**
 * Show a modal dialog with multiple labeled input fields.
 * Returns a record of field values on submit, or null on cancel.
 *
 * Keyboard: Tab to move between fields, Enter on last field to submit, Escape to cancel.
 */
export function showFieldDialog(
  options: FieldDialogOptions,
): Promise<Record<string, string> | null> {
  const { title, fields, submitLabel = "Insert" } = options;

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

    const inputs: HTMLInputElement[] = [];

    for (const field of fields) {
      const fieldLabel = document.createElement("label");
      fieldLabel.className = "field-dialog-label";
      fieldLabel.textContent = field.label;

      const input = document.createElement("input");
      input.className = "ai-prompt-input";
      input.type = "text";
      input.placeholder = field.placeholder ?? "";
      input.dataset.key = field.key;
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.setAttribute("autocorrect", "off");
      input.spellcheck = false;

      fieldLabel.appendChild(input);
      dialog.appendChild(fieldLabel);
      inputs.push(input);
    }

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "ai-prompt-btn ai-prompt-btn-cancel";
    cancelBtn.textContent = "Cancel";

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

    const cleanup = (value: Record<string, string> | null) => {
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
      inputs[i].addEventListener("keydown", (e) => {
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
