import type { ReactNode } from "react";

/** Checkbox on the left, label immediately to the right. The whole row toggles. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="check-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
