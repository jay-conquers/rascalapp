import type { ReactNode } from "react";

/** Checkbox on the left, label immediately to the right. The whole row toggles. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  id,
  setting,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  /** settings.json key, or a dotted key, for the control this row edits. */
  setting?: string;
  children: ReactNode;
}) {
  return (
    <label className="check-row" htmlFor={id}>
      <input
        id={id}
        data-setting={setting}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
